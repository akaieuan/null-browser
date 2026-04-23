//! Sets the macOS Dock / NSApp icon at runtime so it shows the Null mark even
//! when running via `tauri dev` (which launches a raw binary, not a .app
//! bundle, so the Info.plist-based icon path never gets consulted).

#[cfg(target_os = "macos")]
pub fn set_icon() {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let png_bytes: &[u8] = include_bytes!("../icons/icon.png");
    let data = NSData::with_bytes(png_bytes);

    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(Some(&image)) };
}

#[cfg(not(target_os = "macos"))]
pub fn set_icon() {}
