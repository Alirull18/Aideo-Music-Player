use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::UdpSocket;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpnpDevice {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub model_name: String,
    pub location: String,
    pub ip: String,
    pub av_transport_url: Option<String>,
    pub rendering_control_url: Option<String>,
    pub is_connected: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct UpnpStatus {
    pub is_playing: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: u32,
    pub active_device_id: Option<String>,
}

lazy_static::lazy_static! {
    static ref ACTIVE_UPNP_DEVICE: Arc<Mutex<Option<UpnpDevice>>> = Arc::new(Mutex::new(None));
    static ref DISCOVERED_DEVICES: Arc<Mutex<HashMap<String, UpnpDevice>>> = Arc::new(Mutex::new(HashMap::new()));
}

/// Broadcast SSDP M-SEARCH and collect UPnP MediaRenderer devices.
pub async fn discover_upnp_devices() -> Result<Vec<UpnpDevice>, String> {
    let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0);
    let socket = UdpSocket::bind(bind_addr).await.map_err(|e| format!("Failed to bind UDP socket: {}", e))?;
    socket.set_broadcast(true).map_err(|e| format!("Failed to set UDP broadcast: {}", e))?;

    let ssdp_search_targets = [
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:service:AVTransport:1",
        "ssdp:all",
    ];

    let dest_addr: SocketAddr = "239.255.255.250:1900".parse().unwrap();

    for target in &ssdp_search_targets {
        let msg = format!(
            "M-SEARCH * HTTP/1.1\r\n\
             HOST: 239.255.255.250:1900\r\n\
             MAN: \"ssdp:discover\"\r\n\
             MX: 2\r\n\
             ST: {}\r\n\r\n",
            target
        );
        let _ = socket.send_to(msg.as_bytes(), dest_addr).await;
    }

    let mut locations = Vec::new();
    let mut buf = [0u8; 4096];
    let start = std::time::Instant::now();

    // Listen for responses for 2.5 seconds
    while start.elapsed() < Duration::from_millis(2500) {
        if let Ok(Ok((len, _addr))) = tokio::time::timeout(Duration::from_millis(300), socket.recv_from(&mut buf)).await {
            let response = String::from_utf8_lossy(&buf[..len]);
            if let Some(loc) = parse_header_value(&response, "LOCATION") {
                if !locations.contains(&loc) {
                    locations.push(loc);
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let mut discovered = Vec::new();

    for loc in locations {
        if let Ok(res) = client.get(&loc).send().await {
            if let Ok(xml_body) = res.text().await {
                if let Some(mut device) = parse_device_xml(&loc, &xml_body) {
                    if let Ok(lock) = ACTIVE_UPNP_DEVICE.lock() {
                        if let Some(ref active) = *lock {
                            if active.id == device.id {
                                device.is_connected = true;
                            }
                        }
                    }
                    discovered.push(device.clone());
                    if let Ok(mut cache) = DISCOVERED_DEVICES.lock() {
                        cache.insert(device.id.clone(), device);
                    }
                }
            }
        }
    }

    Ok(discovered)
}

fn parse_header_value(res: &str, header: &str) -> Option<String> {
    for line in res.lines() {
        let trimmed = line.trim();
        if let Some(colon_idx) = trimmed.find(':') {
            let key = trimmed[..colon_idx].trim();
            if key.eq_ignore_ascii_case(header) {
                return Some(trimmed[colon_idx + 1..].trim().to_string());
            }
        }
    }
    None
}

/// Parse device description XML to extract friendlyName, manufacturer, and service URLs
pub fn parse_device_xml(location: &str, xml: &str) -> Option<UpnpDevice> {
    let friendly_name = extract_tag_value(xml, "friendlyName")?;
    let manufacturer = extract_tag_value(xml, "manufacturer").unwrap_or_else(|| "Unknown".to_string());
    let model_name = extract_tag_value(xml, "modelName").unwrap_or_else(|| "Media Renderer".to_string());
    let udn = extract_tag_value(xml, "UDN").unwrap_or_else(|| location.to_string());

    // Extract base URL from location for relative URLs
    let base_url = if let Ok(parsed) = url::Url::parse(location) {
        format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""))
            + &parsed.port().map(|p| format!(":{}", p)).unwrap_or_default()
    } else {
        location.to_string()
    };

    let ip = if let Ok(parsed) = url::Url::parse(location) {
        parsed.host_str().unwrap_or("").to_string()
    } else {
        "127.0.0.1".to_string()
    };

    let av_transport_rel = extract_service_control_url(xml, "urn:schemas-upnp-org:service:AVTransport");
    let rendering_control_rel = extract_service_control_url(xml, "urn:schemas-upnp-org:service:RenderingControl");

    let av_transport_url = av_transport_rel.map(|rel| resolve_url(&base_url, &rel));
    let rendering_control_url = rendering_control_rel.map(|rel| resolve_url(&base_url, &rel));

    // Must have an AVTransport service or be a valid MediaRenderer
    if av_transport_url.is_none() && !xml.contains("AVTransport") {
        return None;
    }

    Some(UpnpDevice {
        id: udn,
        name: friendly_name,
        manufacturer,
        model_name,
        location: location.to_string(),
        ip,
        av_transport_url,
        rendering_control_url,
        is_connected: false,
    })
}

fn resolve_url(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else if path.starts_with('/') {
        format!("{}{}", base.trim_end_matches('/'), path)
    } else {
        format!("{}/{}", base.trim_end_matches('/'), path)
    }
}

pub fn extract_tag_value(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    let start = xml.find(&open_tag)? + open_tag.len();
    let end = xml[start..].find(&close_tag)? + start;
    Some(xml[start..end].trim().to_string())
}

pub fn extract_service_control_url(xml: &str, service_type_substr: &str) -> Option<String> {
    let mut current_pos = 0;
    while let Some(service_start) = xml[current_pos..].find("<service>") {
        let actual_start = current_pos + service_start;
        let service_end = xml[actual_start..].find("</service>")? + actual_start;
        let service_block = &xml[actual_start..service_end];

        if service_block.contains(service_type_substr) {
            if let Some(ctrl) = extract_tag_value(service_block, "controlURL") {
                return Some(ctrl);
            }
        }
        current_pos = service_end;
    }
    None
}

/// Connect to a UPnP MediaRenderer device.
pub fn connect_upnp_device(device_id: &str) -> Result<(), String> {
    let cache = DISCOVERED_DEVICES.lock().map_err(|_| "Failed to lock devices")?;
    let device = cache.get(device_id).ok_or_else(|| format!("Device not found: {}", device_id))?;
    
    let mut active = ACTIVE_UPNP_DEVICE.lock().map_err(|_| "Failed to lock active device")?;
    let mut dev_clone = device.clone();
    dev_clone.is_connected = true;
    *active = Some(dev_clone);

    println!("[upnp] Connected to UPnP MediaRenderer: {} ({})", device.name, device.ip);
    Ok(())
}

/// Disconnect the active UPnP MediaRenderer.
pub async fn disconnect_upnp_device() -> Result<(), String> {
    if let Some(device) = {
        let mut active = ACTIVE_UPNP_DEVICE.lock().map_err(|_| "Failed to lock active device")?;
        active.take()
    } {
        println!("[upnp] Disconnected from UPnP MediaRenderer: {}", device.name);
        // Best effort Stop command
        if let Some(ref av_url) = device.av_transport_url {
            let _ = send_soap_action(
                av_url,
                "urn:schemas-upnp-org:service:AVTransport:1",
                "Stop",
                &format_soap_body("Stop", "<InstanceID>0</InstanceID>"),
            ).await;
        }
    }
    Ok(())
}

/// Play a track on the connected UPnP device via AVTransport SOAP actions.
pub async fn upnp_play_stream(
    stream_url: &str,
    title: &str,
    artist: &str,
    album: &str,
    _cover_url: Option<&str>,
    mime_type: &str,
) -> Result<(), String> {
    let device = {
        let active = ACTIVE_UPNP_DEVICE.lock().map_err(|_| "Failed to lock active device")?;
        active.clone().ok_or("No active UPnP device connected")?
    };

    let av_url = device.av_transport_url.ok_or("Device does not support AVTransport")?;

    // 1. Build DIDL-Lite Metadata
    let didl_metadata = format!(
        "&lt;DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
         xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"&gt;\
         &lt;item id=\"1\" parentID=\"0\" restricted=\"1\"&gt;\
         &lt;dc:title&gt;{}&lt;/dc:title&gt;\
         &lt;dc:creator&gt;{}&lt;/dc:creator&gt;\
         &lt;upnp:artist&gt;{}&lt;/upnp:artist&gt;\
         &lt;upnp:album&gt;{}&lt;/upnp:album&gt;\
         &lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;\
         &lt;res protocolInfo=\"http-get:*:{} :DLNA.ORG_PN=FLAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\"&gt;{}&lt;/res&gt;\
         &lt;/item&gt;&lt;/DIDL-Lite&gt;",
        escape_xml(title),
        escape_xml(artist),
        escape_xml(artist),
        escape_xml(album),
        mime_type.trim(),
        escape_xml(stream_url)
    );

    // 2. SetAVTransportURI
    let set_uri_body = format!(
        "<InstanceID>0</InstanceID>\
         <CurrentURI>{}</CurrentURI>\
         <CurrentURIMetaData>{}</CurrentURIMetaData>",
        escape_xml(stream_url),
        didl_metadata
    );

    send_soap_action(
        &av_url,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "SetAVTransportURI",
        &format_soap_body("SetAVTransportURI", &set_uri_body),
    ).await.map_err(|e| format!("SetAVTransportURI failed: {}", e))?;

    // 3. Play
    let play_body = "<InstanceID>0</InstanceID><Speed>1</Speed>";
    send_soap_action(
        &av_url,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "Play",
        &format_soap_body("Play", play_body),
    ).await.map_err(|e| format!("Play failed: {}", e))?;

    println!("[upnp] Started lossless stream on {}: {} - {}", device.name, artist, title);
    Ok(())
}

/// Send transport control commands (Play, Pause, Stop, Seek, SetVolume)
pub async fn upnp_control_action(action: &str, value: Option<f64>) -> Result<(), String> {
    let device = {
        let active = ACTIVE_UPNP_DEVICE.lock().map_err(|_| "Failed to lock active device")?;
        active.clone().ok_or("No active UPnP device connected")?
    };

    match action.to_lowercase().as_str() {
        "pause" => {
            let av_url = device.av_transport_url.ok_or("AVTransport URL missing")?;
            send_soap_action(
                &av_url,
                "urn:schemas-upnp-org:service:AVTransport:1",
                "Pause",
                &format_soap_body("Pause", "<InstanceID>0</InstanceID>"),
            ).await?;
        }
        "play" | "resume" => {
            let av_url = device.av_transport_url.ok_or("AVTransport URL missing")?;
            send_soap_action(
                &av_url,
                "urn:schemas-upnp-org:service:AVTransport:1",
                "Play",
                &format_soap_body("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>"),
            ).await?;
        }
        "stop" => {
            let av_url = device.av_transport_url.ok_or("AVTransport URL missing")?;
            send_soap_action(
                &av_url,
                "urn:schemas-upnp-org:service:AVTransport:1",
                "Stop",
                &format_soap_body("Stop", "<InstanceID>0</InstanceID>"),
            ).await?;
        }
        "seek" => {
            let av_url = device.av_transport_url.ok_or("AVTransport URL missing")?;
            let secs = value.unwrap_or(0.0);
            let time_str = format_hms(secs);
            let seek_body = format!("<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{}</Target>", time_str);
            send_soap_action(
                &av_url,
                "urn:schemas-upnp-org:service:AVTransport:1",
                "Seek",
                &format_soap_body("Seek", &seek_body),
            ).await?;
        }
        "volume" => {
            let rc_url = device.rendering_control_url.ok_or("RenderingControl URL missing")?;
            let vol = value.unwrap_or(50.0).round().clamp(0.0, 100.0) as u32;
            let vol_body = format!("<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{}</DesiredVolume>", vol);
            send_soap_action(
                &rc_url,
                "urn:schemas-upnp-org:service:RenderingControl:1",
                "SetVolume",
                &format_soap_body("SetVolume", &vol_body),
            ).await?;
        }
        _ => return Err(format!("Unsupported UPnP action: {}", action)),
    }

    Ok(())
}

/// Query current playback status and position from the active UPnP renderer.
pub async fn upnp_query_status() -> Result<UpnpStatus, String> {
    let device = {
        let active = ACTIVE_UPNP_DEVICE.lock().map_err(|_| "Failed to lock active device")?;
        active.clone().ok_or("No active UPnP device connected")?
    };

    let mut status = UpnpStatus {
        active_device_id: Some(device.id.clone()),
        ..Default::default()
    };

    if let Some(ref av_url) = device.av_transport_url {
        if let Ok(res) = send_soap_action(
            av_url,
            "urn:schemas-upnp-org:service:AVTransport:1",
            "GetPositionInfo",
            &format_soap_body("GetPositionInfo", "<InstanceID>0</InstanceID>"),
        ).await {
            if let Some(rel_time) = extract_tag_value(&res, "RelTime") {
                status.position_secs = parse_hms_to_secs(&rel_time);
            }
            if let Some(dur) = extract_tag_value(&res, "TrackDuration") {
                status.duration_secs = parse_hms_to_secs(&dur);
            }
        }

        if let Ok(res) = send_soap_action(
            av_url,
            "urn:schemas-upnp-org:service:AVTransport:1",
            "GetTransportInfo",
            &format_soap_body("GetTransportInfo", "<InstanceID>0</InstanceID>"),
        ).await {
            if let Some(state) = extract_tag_value(&res, "CurrentTransportState") {
                status.is_playing = state.eq_ignore_ascii_case("PLAYING");
            }
        }
    }

    Ok(status)
}

fn format_soap_body(action: &str, inner_xml: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
         <s:Body>\
         <u:{} xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">\
         {}\
         </u:{}>\
         </s:Body>\
         </s:Envelope>",
        action, inner_xml, action
    )
}

pub async fn send_soap_action(
    url: &str,
    service_type: &str,
    action: &str,
    soap_body: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.post(url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header("SOAPAction", format!("\"{}#{}\"", service_type, action))
        .body(soap_body.to_string())
        .send()
        .await
        .map_err(|e| format!("HTTP request to {} failed: {}", url, e))?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();

    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("SOAP action {} returned HTTP {}: {}", action, status, body))
    }
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

fn format_hms(secs: f64) -> String {
    let total_secs = secs.max(0.0) as u64;
    let hours = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    format!("{:02}:{:02}:{:02}", hours, mins, s)
}

fn parse_hms_to_secs(hms: &str) -> f64 {
    let parts: Vec<&str> = hms.split(':').collect();
    if parts.len() == 3 {
        let h = parts[0].parse::<f64>().unwrap_or(0.0);
        let m = parts[1].parse::<f64>().unwrap_or(0.0);
        let s = parts[2].parse::<f64>().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_hms_roundtrip() {
        assert_eq!(format_hms(0.0), "00:00:00");
        assert_eq!(format_hms(65.0), "00:01:05");
        assert_eq!(format_hms(3665.0), "01:01:05");
        assert_eq!(parse_hms_to_secs("01:01:05"), 3665.0);
    }

    #[test]
    fn test_escape_xml() {
        assert_eq!(escape_xml("Rock & Roll <Live>"), "Rock &amp; Roll &lt;Live&gt;");
    }

    #[test]
    fn test_extract_tag_value() {
        let xml = "<root><friendlyName>Living Room Sonos</friendlyName><manufacturer>Sonos</manufacturer></root>";
        assert_eq!(extract_tag_value(xml, "friendlyName"), Some("Living Room Sonos".to_string()));
        assert_eq!(extract_tag_value(xml, "manufacturer"), Some("Sonos".to_string()));
        assert_eq!(extract_tag_value(xml, "nonexistent"), None);
    }

    #[test]
    fn test_parse_device_xml() {
        let xml = r#"
        <root>
          <device>
            <friendlyName>Wiim Pro Hi-Res Streamer</friendlyName>
            <manufacturer>Linkplay</manufacturer>
            <modelName>WiiM Pro</modelName>
            <UDN>uuid:12345678-abcd-ef01-2345-6789abcdef01</UDN>
            <serviceList>
              <service>
                <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
                <controlURL>/upnp/control/avtransport</controlURL>
              </service>
              <service>
                <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
                <controlURL>/upnp/control/renderingcontrol</controlURL>
              </service>
            </serviceList>
          </device>
        </root>
        "#;

        let dev = parse_device_xml("http://192.168.1.50:49152/description.xml", xml).unwrap();
        assert_eq!(dev.name, "Wiim Pro Hi-Res Streamer");
        assert_eq!(dev.manufacturer, "Linkplay");
        assert_eq!(dev.av_transport_url.as_deref(), Some("http://192.168.1.50:49152/upnp/control/avtransport"));
        assert_eq!(dev.rendering_control_url.as_deref(), Some("http://192.168.1.50:49152/upnp/control/renderingcontrol"));
    }
}
