#![cfg(target_os = "macos")]

use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSDictionary, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNNotification, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Wry};

use crate::NotificationPayload;

pub static APP_HANDLE: Mutex<Option<AppHandle<Wry>>> = Mutex::new(None);

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CadenceNotificationDelegate"]
    pub struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        /// Show notifications even when the app is in the foreground.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present_notification(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: *mut block2::Block<dyn Fn(usize)>,
        ) {
            // UNNotificationPresentationOptions bitmask: Banner(1<<4) | Sound(1<<1) | List(1<<0)
            let options: usize = (1 << 4) | (1 << 1) | (1 << 0);
            unsafe {
                if !completion_handler.is_null() {
                    (*completion_handler).call((options,));
                }
            }
        }

        /// Handle notification click — extract userInfo and emit Tauri event.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_response(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: *mut block2::Block<dyn Fn()>,
        ) {
            handle_notification_response(response);
            unsafe {
                if !completion_handler.is_null() {
                    (*completion_handler).call(());
                }
            }
        }
    }
);

fn handle_notification_response(response: &UNNotificationResponse) {
    let notification = response.notification();
    let request = notification.request();
    let content = request.content();
    let user_info = content.userInfo();

    let feature_key = NSString::from_str("feature_id");
    let project_key = NSString::from_str("project_id");
    let route_key = NSString::from_str("route_type");

    let feature_id = extract_i64_from_dict(&user_info, &feature_key).unwrap_or(0);
    let project_id = extract_i64_from_dict(&user_info, &project_key).unwrap_or(0);
    let route_type =
        extract_string_from_dict(&user_info, &route_key).unwrap_or_else(|| "workflow".to_string());

    let payload = NotificationPayload {
        feature_id,
        project_id,
        route_type,
    };

    if let Some(handle) = APP_HANDLE.lock().ok().and_then(|g| g.clone()) {
        let _ = handle.emit("notification-clicked", &payload);
    }
}

fn extract_i64_from_dict(dict: &NSDictionary<AnyObject, AnyObject>, key: &NSString) -> Option<i64> {
    let key_obj: &AnyObject = unsafe { &*(key as *const NSString as *const AnyObject) };
    let val = dict.objectForKey(key_obj)?;
    let ns_str: &NSString = unsafe { &*(&*val as *const AnyObject as *const NSString) };
    ns_str.to_string().parse().ok()
}

fn extract_string_from_dict(
    dict: &NSDictionary<AnyObject, AnyObject>,
    key: &NSString,
) -> Option<String> {
    let key_obj: &AnyObject = unsafe { &*(key as *const NSString as *const AnyObject) };
    let val = dict.objectForKey(key_obj)?;
    let ns_str: &NSString = unsafe { &*(&*val as *const AnyObject as *const NSString) };
    Some(ns_str.to_string())
}

impl NotificationDelegate {
    pub fn new(mtm: MainThreadMarker) -> Retained<Self> {
        unsafe { msg_send![Self::alloc(mtm), init] }
    }
}
