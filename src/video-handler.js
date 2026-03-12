const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

/**
 * Download a file from URL to a temporary location
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadFile(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(destPath);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Extract a thumbnail frame from a video using system ffmpeg
 * Takes a frame at 1 second (or 0 if video is shorter)
 *
 * @param {string} videoUrl - URL of the video
 * @returns {string} - Base64-encoded JPEG of the extracted frame
 */
async function extractVideoThumbnail(videoUrl) {
  const tmpDir = os.tmpdir();
  const videoPath = path.join(tmpDir, `datocms-video-${Date.now()}.mp4`);
  const framePath = path.join(tmpDir, `datocms-frame-${Date.now()}.jpg`);

  try {
    // Download video
    await downloadFile(videoUrl, videoPath);

    // Extract frame using system ffmpeg
    await new Promise((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-i", videoPath,
          "-ss", "00:00:01",
          "-vframes", "1",
          "-vf", "scale=1280:-1",
          "-q:v", "2",
          "-y",
          framePath,
        ],
        { timeout: 30000 },
        (error) => {
          if (error) {
            // Retry at 0s for very short videos
            execFile(
              "ffmpeg",
              [
                "-i", videoPath,
                "-ss", "00:00:00",
                "-vframes", "1",
                "-vf", "scale=1280:-1",
                "-q:v", "2",
                "-y",
                framePath,
              ],
              { timeout: 30000 },
              (err2) => {
                if (err2) reject(new Error(`ffmpeg failed: ${err2.message}. Is ffmpeg installed?`));
                else resolve();
              },
            );
          } else {
            resolve();
          }
        },
      );
    });

    // Read as base64
    const frameBuffer = fs.readFileSync(framePath);
    return frameBuffer.toString("base64");
  } finally {
    try { fs.unlinkSync(videoPath); } catch {}
    try { fs.unlinkSync(framePath); } catch {}
  }
}

/**
 * Check if a mime type is video
 */
function isVideo(mimeType) {
  return mimeType && mimeType.startsWith("video/");
}

/**
 * Check if a mime type is an image
 */
function isImage(mimeType) {
  return mimeType && mimeType.startsWith("image/");
}

/**
 * Check if asset type is supported for ALT generation
 */
function isSupportedMedia(mimeType) {
  return isImage(mimeType) || isVideo(mimeType);
}

module.exports = {
  extractVideoThumbnail,
  isVideo,
  isImage,
  isSupportedMedia,
};
