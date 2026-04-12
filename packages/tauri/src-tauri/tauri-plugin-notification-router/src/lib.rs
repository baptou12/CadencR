mod commands;
#[cfg(target_os = "macos")]
mod delegate;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
use delegate::{NotificationDelegate, APP_HANDLE};
#[cfg(target_os = "macos")]
use objc2::runtime::{Bool, ProtocolObject};
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSBundle, NSError, NSSet, NSString};
#[cfg(target_os = "macos")]
use objc2_user_notifications::{
    UNAuthorizationOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Wry,
};

#[cfg(not(target_os = "macos"))]
use std::sync::Mutex;
#[cfg(not(target_os = "macos"))]
pub static APP_HANDLE: Mutex<Option<tauri::AppHandle<Wry>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub feature_id: i64,
    pub project_id: i64,
    pub route_type: String,
}

/// Authorization result, set once by the completion handler in request_authorization.
pub static PERMISSION_GRANTED: OnceLock<bool> = OnceLock::new();

/// Whether the notification system is available (requires a proper .app bundle).
pub static NOTIFICATIONS_AVAILABLE: AtomicBool = AtomicBool::new(false);

pub fn init() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("notification-router")
        .invoke_handler(tauri::generate_handler![
            commands::send_notification,
            commands::check_permission,
        ])
        .setup(|app, _api| {
            #[cfg(not(target_os = "macos"))]
            {
                *APP_HANDLE.lock().unwrap() = Some(app.clone());
                return Ok(());
            }

            #[cfg(target_os = "macos")]
            {
                *APP_HANDLE.lock().unwrap() = Some(app.clone());

                let bundle = NSBundle::mainBundle();
                if bundle.bundleIdentifier().is_none() {
                    return Ok(());
                }

                NOTIFICATIONS_AVAILABLE.store(true, Ordering::Relaxed);
                request_authorization();
                setup_delegate();
                register_category();

                Ok(())
            }
        })
        .build()
}

#[cfg(target_os = "macos")]
fn request_authorization() {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
    let handler = block2::RcBlock::new(|granted: Bool, _error: *mut NSError| {
        let _ = PERMISSION_GRANTED.set(granted.as_bool());
    });
    center.requestAuthorizationWithOptions_completionHandler(options, &handler);
}

#[cfg(target_os = "macos")]
fn setup_delegate() {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    if let Some(mtm) = MainThreadMarker::new() {
        let delegate = NotificationDelegate::new(mtm);
        let delegate_ref: &NotificationDelegate = &delegate;
        let proto: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
            ProtocolObject::from_ref(delegate_ref);
        center.setDelegate(Some(proto));
        std::mem::forget(delegate);
    }
}

#[cfg(target_os = "macos")]
fn register_category() {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let category_id = NSString::from_str("AGENT_COMPLETE");

    let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &category_id,
        &NSArray::new(),
        &NSArray::new(),
        UNNotificationCategoryOptions::empty(),
    );

    let categories = NSSet::from_retained_slice(&[category]);
    center.setNotificationCategories(&categories);
}
