/**
 * Studio Hub V2 — Local HTTP API, Upload Progress & Safe Media URL Resolver
 */

/**
 * Perform a JSON-aware fetch against the local Studio Hub server.
 * @param {string} url
 * @param {RequestInit & { body?: unknown }} [opts]
 */
export async function api(url, opts = {}) {
  const requestInit = { ...opts };
  const headers = { ...(opts.headers || {}) };

  const isRawBody =
    typeof requestInit.body === "string" ||
    requestInit.body === undefined ||
    requestInit.body === null ||
    (typeof Blob !== "undefined" && requestInit.body instanceof Blob) ||
    (typeof FormData !== "undefined" && requestInit.body instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && requestInit.body instanceof URLSearchParams) ||
    requestInit.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(requestInit.body);

  if (!isRawBody && typeof requestInit.body === "object") {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    requestInit.body = JSON.stringify(requestInit.body);
  }

  requestInit.headers = headers;

  const response = await fetch(url, requestInit);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok === false) {
    const reason =
      data?.error || data?.message || `Unable to complete request (${response.status}).`;
    throw new Error(reason);
  }

  return data;
}

/**
 * Stream a local File/Blob to `/api/projects/:slug/upload` with upload progress callbacks.
 * Calls `onProgress(percent, { percent, loaded, total })`.
 *
 * @param {string} slug
 * @param {string} category
 * @param {File | Blob & { name?: string }} file
 * @param {(percent: number, detail: { percent: number; loaded: number; total: number }) => void} [onProgress]
 */
export function uploadFileWithProgress(slug, category, file, onProgress) {
  if (!slug) {
    return Promise.reject(new Error("Active project slug is required for file upload."));
  }
  if (!file) {
    return Promise.reject(new Error("No file provided for upload."));
  }

  const safeCategory = category || "raw-video";
  const filename = file.name || `upload_${Date.now()}.bin`;
  const endpoint = `/api/projects/${encodeURIComponent(slug)}/upload?category=${encodeURIComponent(
    safeCategory,
  )}&filename=${encodeURIComponent(filename)}`;

  if (typeof XMLHttpRequest === "undefined") {
    if (typeof onProgress === "function") {
      onProgress(0, { percent: 0, loaded: 0, total: file.size || 0 });
    }
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }).then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Upload failed (${res.status}).`);
      }
      const size = file.size || 0;
      if (typeof onProgress === "function") {
        onProgress(100, { percent: 100, loaded: size, total: size });
      }
      return payload;
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (typeof onProgress !== "function") return;
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size || 1;
      const loaded = event.loaded || 0;
      const percent = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
      onProgress(percent, { percent, loaded, total });
    });

    xhr.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok !== false) {
        const total = file.size || 0;
        if (typeof onProgress === "function") {
          onProgress(100, { percent: 100, loaded: total, total });
        }
        resolve(payload);
      } else {
        reject(new Error(payload?.error || `Upload failed (${xhr.status}).`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error while uploading file."));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("File upload was cancelled."));
    });

    xhr.send(file);
  });
}

/**
 * Safely convert relative project paths (`.studio/...`, `assets/...`, `inbox/...`, `output/...`)
 * into `/media/:slug/...` while preserving `http(s)://`, `/media/...`, `blob:`, and `data:image/...`.
 *
 * @param {string | null | undefined} slug
 * @param {string | null | undefined} pathOrUrl
 * @param {string | number} [cacheToken]
 * @returns {string}
 */
export function resolveMediaUrl(slug, pathOrUrl, cacheToken = "") {
  if (!pathOrUrl) return "";
  const raw = String(pathOrUrl).trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("blob:")) {
    return raw;
  }

  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("data:") || raw.startsWith("javascript:")) {
    return "";
  }

  if (raw.startsWith("/media/")) {
    if (!cacheToken) return raw;
    const cleanBase = raw.split("?")[0];
    return `${cleanBase}?v=${encodeURIComponent(String(cacheToken))}`;
  }

  if (!slug) return "";

  let normalized = raw.replaceAll("\\", "/");
  const cleanQuerySplit = normalized.split("?");
  normalized = cleanQuerySplit[0];
  const existingQuery = cleanQuerySplit[1] || "";

  const projectMarker = `/projects/${slug}/`;
  const markerIndex = normalized.toLowerCase().indexOf(projectMarker.toLowerCase());
  if (markerIndex !== -1) {
    normalized = normalized.slice(markerIndex + projectMarker.length);
  }

  normalized = normalized.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    return "";
  }

  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join("/");

  const baseUrl = `/media/${encodeURIComponent(slug)}/${encodedPath}`;
  if (cacheToken) {
    return `${baseUrl}?v=${encodeURIComponent(String(cacheToken))}`;
  }
  return existingQuery ? `${baseUrl}?${existingQuery}` : baseUrl;
}

/**
 * Format byte sizes in plain human-readable KB / MB.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 KB";
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

/**
 * Validate external HTTP/HTTPS links before rendering in anchor hrefs.
 * @param {string} rawUrl
 * @returns {string | null}
 */
export function sanitizeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}
