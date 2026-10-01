use std::ffi::CStr;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

/// Where a root lives. Only local, internal volumes are indexed; the walker also stays on each
/// root's own file system, so volumes mounted below a root are never entered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VolumeKind {
    Local,
    /// Not flagged `MNT_LOCAL`: SMB, AFP, NFS, WebDAV and similar mounts.
    Network,
    /// Mounted under `/Volumes`, where macOS mounts external and removable disks. The startup
    /// volume group mounts at `/` and `/System/Volumes/Data`, so a local home never lands here.
    /// This is a mount-point heuristic; DiskArbitration would be needed to read the media flags.
    External,
    Unknown,
}

pub(crate) fn classify(path: &Path) -> VolumeKind {
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return VolumeKind::Unknown;
    };
    // SAFETY: `statfs` only writes into the zeroed struct we own and reads the NUL-terminated
    // path, which outlives the call.
    let (status, info) = unsafe {
        let mut info: libc::statfs = std::mem::zeroed();
        (libc::statfs(c_path.as_ptr(), &mut info), info)
    };
    if status != 0 {
        return VolumeKind::Unknown;
    }
    if info.f_flags & libc::MNT_LOCAL as u32 == 0 {
        return VolumeKind::Network;
    }
    // SAFETY: the kernel NUL-terminates `f_mntonname` within its fixed-size buffer.
    let mount_point = unsafe { CStr::from_ptr(info.f_mntonname.as_ptr()) };
    if mount_point.to_bytes().starts_with(b"/Volumes/") {
        VolumeKind::External
    } else {
        VolumeKind::Local
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_temp_folder_is_local() {
        let temp = std::env::temp_dir().canonicalize().unwrap();
        assert_eq!(classify(&temp), VolumeKind::Local);
    }

    #[test]
    fn a_missing_path_is_unknown() {
        assert_eq!(
            classify(Path::new("/definitely/not/here")),
            VolumeKind::Unknown
        );
    }
}
