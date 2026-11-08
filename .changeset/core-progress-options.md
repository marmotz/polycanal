---
"@polycanal/core": minor
---

`CallOptions` and `ActionCall` accept `onUploadProgress` and `onDownloadProgress` callbacks, copied into the call
for the driver. The new `UploadProgress`, `FileProgress` and `DownloadProgress` types describe what a driver reports;
a driver that cannot measure progress ignores the callbacks.
