# Privacy Policy for Aideo Music Player

**Last Updated:** October 1, 2026

Welcome to **Aideo Music Player** ("Aideo", "we", "us", or "our"). We respect your privacy and are committed to protecting your personal data. This Privacy Policy outlines our principles regarding the collection, storage, and processing of data when you use the Aideo desktop application.

---

## 1. Overview & Core Philosophy
Aideo Music Player is designed as an **offline-first, local music player**. 
* We do **not** sell, rent, or trade your personal information.
* We do **not** use third-party behavioral advertising or data-broker SDKs.
* Your local audio files and personal media remain strictly on your device.

---

## 2. Information Handled by the Application

### A. Local Audio Files & Library Data
* **Data Handled:** File system paths, audio tags (title, artist, album, genre, year, track number, cover art), audio codecs, sample rates, and bit depths.
* **Processing:** All indexing, audio tag extraction, and audio playback take place **locally on your device**. Your audio files (e.g. FLAC, WAV, MP3, AAC, ALAC) are never transmitted or uploaded to external servers.

### B. Account & Cloud Sync Data (Optional)
If you optionally sign in to sync your data across devices:
* **Account Information:** Email address and authentication tokens managed securely via our backend provider (**Supabase**).
* **Synced Content:** Liked songs, custom playlists, player preferences/settings, and listening statistics.
* **Choice:** Account registration is entirely optional. You can use all core audio player features in complete offline mode.

### C. Optional Integrations & Scrobbling (User-Initiated)
If you enable optional third-party integrations:
* **Last.fm & ListenBrainz:** If scrobbling is enabled in settings, currently playing track metadata (song title, artist, album) is sent directly to your configured account on those services via their respective APIs.
* **MusicBrainz & Cover Art Providers:** When fetching missing album metadata or cover art, public search queries containing track/album names are sent to open music databases.
* **Discord Rich Presence:** If enabled, current playback state (title and artist) is shared locally with your Discord desktop client to display your activity status.

### D. Application Updates
* To notify you of bug fixes and performance improvements, the app periodically checks for updates against official GitHub release manifests (`api.github.com` or repository releases). This standard request transmits only basic client metadata (current app version and OS architecture).

---

## 3. Third-Party Service Providers
We partner only with industry-standard, privacy-compliant infrastructure providers:
* **Supabase:** Used for optional user authentication and encrypted database synchronization.
* **GitHub:** Hosts the open-source repository and binary release distributions.

We do **not** embed telemetry or tracking networks (such as Google Analytics or Facebook Pixel).

---

## 4. Data Retention, Control, and Deletion
* **Local Data:** You have full control over your local data. You can clear cache and database records directly from within the app settings or by removing the local app data folder (`%LOCALAPPDATA%/com.alirul.music-player` or `app.db`).
* **Cloud Data:** If you have registered an account and wish to delete your account or any synced records permanently, you may request deletion at any time via the contact channels listed below.

---

## 5. Security
We implement strict local and transmission security:
* All network communications (syncing, updates, metadata retrieval) are encrypted using standard Transport Layer Security (TLS/HTTPS).
* Local credentials and session tokens are stored securely in local app storage.

---

## 6. Children's Privacy
Aideo Music Player does not knowingly collect or solicit personal data from children under the age of 13.

---

## 7. Changes to this Policy
We may periodically update this Privacy Policy. The latest version will always be maintained in our official repository with an updated revision date.

---

## 8. Contact Us
If you have questions, feedback, or data requests regarding this Privacy Policy, please contact:
* **Developer / Maintainer:** Alirul
* **GitHub Repository:** [https://github.com/Alirul18/Aideo-Music-Player](https://github.com/Alirul18/Aideo-Music-Player)
* **Project Website:** [https://alirull18.github.io/Aideo-Music-Player/](https://alirull18.github.io/Aideo-Music-Player/)
