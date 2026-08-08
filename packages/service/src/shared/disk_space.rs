//! Read-only filesystem capacity helpers for operations that make a temporary
//! SQLite copy. Returning `None` is preferable to guessing on an unsupported
//! platform; callers decide whether an unknown capacity is safe for their job.

use std::path::Path;

#[cfg(unix)]
pub fn available_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;

    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: `statvfs` only reads through the NUL-terminated path we own and
    // writes into a zeroed struct that lives for the whole call.
    let stats = unsafe {
        let mut stats = std::mem::zeroed::<libc::statvfs>();
        if libc::statvfs(path.as_ptr(), &mut stats) != 0 {
            return None;
        }
        stats
    };
    (stats.f_bavail as u64).checked_mul(stats.f_frsize as u64)
}

#[cfg(windows)]
pub fn available_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let path = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available = 0u64;
    // SAFETY: `path` is NUL-terminated and remains alive for the call. The API
    // writes only to `available`; the two totals are intentionally omitted.
    let succeeded = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } != 0;
    succeeded.then_some(available)
}

#[cfg(all(not(unix), not(windows)))]
pub fn available_bytes(_dir: &Path) -> Option<u64> {
    None
}

pub fn human_bytes(bytes: u64) -> String {
    const GIB: u64 = 1024 * 1024 * 1024;
    if bytes >= GIB {
        return format!("{:.1} GB", bytes as f64 / GIB as f64);
    }
    format!("{} MB", bytes / (1024 * 1024))
}
