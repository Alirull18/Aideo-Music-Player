use windows::Win32::Foundation::{HWND, LRESULT, WPARAM, LPARAM, HANDLE};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, CallWindowProcW, SetPropW, GetPropW,
    GWLP_WNDPROC, WNDPROC, WM_COMMAND, HICON, LoadIconW, IDI_APPLICATION,
};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THUMBBUTTON, THB_ICON, THB_TOOLTIP, THB_FLAGS,
    THBF_ENABLED, ExtractIconW,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::core::w;
use tauri::Emitter;

const PROP_ORIG_WNDPROC: windows::core::PCWSTR = w!("AideoOrigWndProc");
const PROP_APP_HANDLE: windows::core::PCWSTR = w!("AideoAppHandle");

// Dynamic Icons cached for state switches
static mut ICON_PLAY: HICON = HICON(0);
static mut ICON_PAUSE: HICON = HICON(0);
static mut ICON_PREV: HICON = HICON(0);
static mut ICON_NEXT: HICON = HICON(0);

fn load_icon(imageres_idx: i32, shell32_idx: i32) -> HICON {
    unsafe {
        let hicon = ExtractIconW(None, w!("imageres.dll"), imageres_idx as u32);
        if hicon.0 != 0 && hicon.0 != 1 {
            return hicon;
        }
        let hicon_shell = ExtractIconW(None, w!("shell32.dll"), shell32_idx as u32);
        if hicon_shell.0 != 0 && hicon_shell.0 != 1 {
            return hicon_shell;
        }
        // Fallback to generic system application icon
        LoadIconW(None, IDI_APPLICATION).unwrap_or(HICON(0))
    }
}

fn create_button(id: u32, hicon: HICON, tooltip: &str) -> THUMBBUTTON {
    let mut sz_tip = [0u16; 260];
    let tooltip_w: Vec<u16> = tooltip.encode_utf16().collect();
    let len = tooltip_w.len().min(259);
    sz_tip[..len].copy_from_slice(&tooltip_w[..len]);

    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: hicon,
        szTip: sz_tip,
        dwFlags: THBF_ENABLED,
    }
}

unsafe extern "system" fn taskbar_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_COMMAND {
        let control_id = (wparam.0 & 0xFFFF) as u32;
        let code = ((wparam.0 >> 16) & 0xFFFF) as u16;
        
        // Thumbnail toolbar button click notifications have a code of 0 (THBN_CLICKED)
        if code == 0 {
            if let Some(app_handle) = get_app_handle_from_prop(hwnd) {
                match control_id {
                    101 => {
                        // Play/Pause toggle event
                        let _ = app_handle.emit("media-toggle", ());
                    }
                    102 => {
                        // Previous track event
                        let _ = app_handle.emit("media-prev", ());
                    }
                    103 => {
                        // Next track event
                        let _ = app_handle.emit("media-next", ());
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(orig_wndproc) = get_original_wndproc_from_prop(hwnd) {
        CallWindowProcW(orig_wndproc, hwnd, msg, wparam, lparam)
    } else {
        LRESULT(0)
    }
}

unsafe fn get_app_handle_from_prop(hwnd: HWND) -> Option<tauri::AppHandle> {
    let prop = GetPropW(hwnd, PROP_APP_HANDLE);
    if prop.is_invalid() {
        None
    } else {
        let boxed_handle = prop.0 as *const tauri::AppHandle;
        if !boxed_handle.is_null() {
            Some((*boxed_handle).clone())
        } else {
            None
        }
    }
}

unsafe fn get_original_wndproc_from_prop(hwnd: HWND) -> Option<WNDPROC> {
    let prop = GetPropW(hwnd, PROP_ORIG_WNDPROC);
    if prop.is_invalid() {
        None
    } else {
        Some(std::mem::transmute::<isize, WNDPROC>(prop.0))
    }
}

pub fn initialize_taskbar_buttons(hwnd_raw: *mut std::ffi::c_void, app_handle: tauri::AppHandle) {
    let hwnd = HWND(hwnd_raw as isize);
    unsafe {
        // 1. Initialize Icons
        ICON_PLAY = load_icon(240, 137);
        ICON_PAUSE = load_icon(241, 138);
        ICON_PREV = load_icon(244, 146);
        ICON_NEXT = load_icon(243, 145);

        // 2. Box and store tauri::AppHandle in HWND property
        let boxed_handle = Box::into_raw(Box::new(app_handle));
        let _ = SetPropW(hwnd, PROP_APP_HANDLE, HANDLE(boxed_handle as isize));

        // 3. Subclass the main window Proc
        let orig_wndproc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        let _ = SetPropW(hwnd, PROP_ORIG_WNDPROC, HANDLE(orig_wndproc as isize));
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, taskbar_wndproc as *const () as isize);

        // 4. Create Thumbbar buttons
        if let Ok(taskbar_list) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL) {
            if taskbar_list.HrInit().is_ok() {
                let buttons = [
                    create_button(102, ICON_PREV, "Previous Track"),
                    create_button(101, ICON_PLAY, "Play"),
                    create_button(103, ICON_NEXT, "Next Track"),
                ];
                let _ = taskbar_list.ThumbBarAddButtons(hwnd, &buttons);
            }
        }
    }
}

pub fn update_taskbar_playback_state(hwnd_raw: *mut std::ffi::c_void, playing: bool) {
    let hwnd = HWND(hwnd_raw as isize);
    unsafe {
        if let Ok(taskbar_list) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_ALL) {
            if taskbar_list.HrInit().is_ok() {
                let play_pause_icon = if playing { ICON_PAUSE } else { ICON_PLAY };
                let play_pause_tip = if playing { "Pause" } else { "Play" };
                
                let buttons = [
                    create_button(102, ICON_PREV, "Previous Track"),
                    create_button(101, play_pause_icon, play_pause_tip),
                    create_button(103, ICON_NEXT, "Next Track"),
                ];
                let _ = taskbar_list.ThumbBarUpdateButtons(hwnd, &buttons);
            }
        }
    }
}
