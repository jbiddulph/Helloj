const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENAI_API_KEY = normalizeOpenAiApiKey(process.env.OPENAI_API_KEY || "");
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
const DEFAULT_VINTED_LIMIT = 12;
const MAX_VINTED_LIMIT = 24;
const VINTED_CATEGORY_CONFIG = {
  "shirts-tops": {
    label: "Shirts / Tops",
    searchText: "shirt top",
  },
  hat: {
    label: "Hat",
    searchText: "hat",
  },
  trousers: {
    label: "Trousers",
    searchText: "trousers pants",
  },
  dresses: {
    label: "Dresses",
    searchText: "dress",
  },
};
const ASPECT_RATIO_SIZE_MAP = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(data));
}

function serveStaticFile(requestPath, response) {
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "Not Found" });
        return;
      }
      sendJson(response, 500, { error: "Internal Server Error" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
}

function readJsonBody(request, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        resolve(parsedBody);
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", () => {
      reject(new Error("Failed to read request body."));
    });
  });
}

function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw new Error("Image must be a base64 data URL string.");
  }

  const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!matches) {
    throw new Error("Image data URL format is invalid.");
  }

  const parsedMimeType = matches[1].toLowerCase();
  const mimeType = parsedMimeType === "image/jpg" ? "image/jpeg" : parsedMimeType;
  const base64Payload = matches[2].replace(/\s/g, "");
  const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supportedMimeTypes.has(mimeType)) {
    throw new Error("Only PNG, JPG, JPEG, and WEBP images are supported.");
  }

  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.length) {
    throw new Error("Image data cannot be empty.");
  }

  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Each image must be smaller than 8MB.");
  }

  const extension = mimeType === "image/jpeg" || mimeType === "image/jpg" ? "jpg" : mimeType.split("/")[1];
  return { buffer, mimeType, extension };
}

function normalizeAspectRatio(value) {
  if (typeof value !== "string") {
    return "square";
  }
  return Object.prototype.hasOwnProperty.call(ASPECT_RATIO_SIZE_MAP, value) ? value : "square";
}

function normalizeBackgroundPreservation(value) {
  if (value === "strict" || value === "balanced" || value === "creative") {
    return value;
  }
  return "balanced";
}

function normalizeChangeStrength(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 78;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeOpenAiApiKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  let normalizedValue = value.trim();
  if (
    (normalizedValue.startsWith("\"") && normalizedValue.endsWith("\"")) ||
    (normalizedValue.startsWith("'") && normalizedValue.endsWith("'"))
  ) {
    normalizedValue = normalizedValue.slice(1, -1).trim();
  }

  if (normalizedValue.toLowerCase().startsWith("bearer ")) {
    normalizedValue = normalizedValue.slice(7).trim();
  }

  return normalizedValue;
}

function getOpenAiApiKeyValidationError(apiKey) {
  if (!apiKey) {
    return "OPENAI_API_KEY is not configured on the server.";
  }

  if (/\s/.test(apiKey)) {
    return "OPENAI_API_KEY contains whitespace. Please reconfigure the key without spaces or newlines.";
  }

  if (!apiKey.startsWith("sk-")) {
    return "OPENAI_API_KEY format looks invalid. Set the raw API key value (starting with sk-) without quotes or a Bearer prefix.";
  }

  return "";
}

function normalizeImageModel(value) {
  if (typeof value !== "string") {
    return DEFAULT_OPENAI_IMAGE_MODEL;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return DEFAULT_OPENAI_IMAGE_MODEL;
  }

  const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
  if (!modelPattern.test(trimmedValue)) {
    return DEFAULT_OPENAI_IMAGE_MODEL;
  }

  return trimmedValue;
}

function buildNormalizedImageDataUrl(image) {
  return `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value.includes("&")) {
    return typeof value === "string" ? value : "";
  }

  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hexCodePoint) => String.fromCodePoint(Number.parseInt(hexCodePoint, 16)))
    .replace(/&#([0-9]+);/g, (_, decimalCodePoint) => String.fromCodePoint(Number.parseInt(decimalCodePoint, 10)));
}

function stripHtmlTags(value) {
  if (typeof value !== "string") {
    return "";
  }
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractHtmlAttribute(tag, attributeName) {
  if (typeof tag !== "string" || !tag) {
    return "";
  }
  const attributePattern = new RegExp(`${attributeName}="([^"]*)"`, "i");
  const matches = tag.match(attributePattern);
  return decodeHtmlEntities(matches?.[1] || "");
}

function normalizeVintedCategory(value) {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(VINTED_CATEGORY_CONFIG, value)) {
    return value;
  }
  return "shirts-tops";
}

function normalizeVintedLimit(value) {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    return DEFAULT_VINTED_LIMIT;
  }
  return Math.max(1, Math.min(MAX_VINTED_LIMIT, parsedValue));
}

function extractVintedItemsFromHtml(html, limit) {
  if (typeof html !== "string" || !html) {
    return [];
  }

  const ids = [];
  const seenIds = new Set();
  const idPattern = /data-testid="product-item-id-(\d+)--overlay-link"/g;
  let idMatch;
  while ((idMatch = idPattern.exec(html)) && ids.length < limit * 3) {
    const itemId = idMatch[1];
    if (!seenIds.has(itemId)) {
      seenIds.add(itemId);
      ids.push(itemId);
    }
  }

  const items = [];
  for (const itemId of ids) {
    const imageTagPattern = new RegExp(`<img[^>]*data-testid="product-item-id-${itemId}--image--img"[^>]*>`, "i");
    const overlayTagPattern = new RegExp(`<a[^>]*data-testid="product-item-id-${itemId}--overlay-link"[^>]*>`, "i");
    const titlePattern = new RegExp(
      `<p[^>]*data-testid="product-item-id-${itemId}--description-title"[^>]*>([\\s\\S]*?)<\\/p>`,
      "i"
    );
    const subtitlePattern = new RegExp(
      `<p[^>]*data-testid="product-item-id-${itemId}--description-subtitle"[^>]*>([\\s\\S]*?)<\\/p>`,
      "i"
    );
    const pricePattern = new RegExp(`<p[^>]*data-testid="product-item-id-${itemId}--price-text"[^>]*>([\\s\\S]*?)<\\/p>`, "i");

    const imageTag = html.match(imageTagPattern)?.[0] || "";
    const overlayTag = html.match(overlayTagPattern)?.[0] || "";
    if (!imageTag || !overlayTag) {
      continue;
    }

    const thumbnailUrl = extractHtmlAttribute(imageTag, "src");
    const itemUrl = extractHtmlAttribute(overlayTag, "href");
    if (!thumbnailUrl || !itemUrl) {
      continue;
    }

    const overlayTitle = extractHtmlAttribute(overlayTag, "title");
    const brandTitle = stripHtmlTags(html.match(titlePattern)?.[1] || "");
    const subtitle = stripHtmlTags(html.match(subtitlePattern)?.[1] || "");
    const price = stripHtmlTags(html.match(pricePattern)?.[1] || "");
    const fallbackTitle = overlayTitle.split(",")[0].trim();

    let normalizedItemUrl = itemUrl;
    try {
      normalizedItemUrl = new URL(itemUrl, "https://www.vinted.com").toString();
    } catch (error) {
      normalizedItemUrl = itemUrl;
    }

    items.push({
      id: itemId,
      title: brandTitle || fallbackTitle || "Vinted garment",
      subtitle,
      price,
      itemUrl: normalizedItemUrl,
      thumbnailUrl,
      alt: overlayTitle || "Vinted garment",
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

async function fetchVintedGarments(category, limit) {
  const categoryConfig = VINTED_CATEGORY_CONFIG[category];
  if (!categoryConfig) {
    throw new Error("Unsupported Vinted category.");
  }

  const catalogUrl = new URL("https://www.vinted.com/catalog");
  catalogUrl.searchParams.set("search_text", categoryConfig.searchText);

  const response = await fetch(catalogUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Vinted catalog request failed with HTTP ${response.status}.`);
  }

  const html = await response.text();
  const items = extractVintedItemsFromHtml(html, limit);
  return {
    category,
    categoryLabel: categoryConfig.label,
    items,
  };
}

function isAllowedVintedImageUrl(imageUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (error) {
    return false;
  }

  if (parsedUrl.protocol !== "https:") {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  return hostname === "images1.vinted.net" || hostname === "images2.vinted.net" || hostname.endsWith(".vinted.net");
}

async function fetchImageDataUrlFromRemote(imageUrl, maxBytes = 8 * 1024 * 1024) {
  if (!isAllowedVintedImageUrl(imageUrl)) {
    throw new Error("Only HTTPS images hosted on vinted.net are allowed.");
  }

  const response = await fetch(imageUrl, {
    headers: {
      Accept: "image/*",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}.`);
  }

  const contentTypeHeader = response.headers.get("content-type") || "";
  const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("Selected URL did not return an image.");
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (!imageBuffer.length) {
    throw new Error("Selected image is empty.");
  }
  if (imageBuffer.length > maxBytes) {
    throw new Error("Selected image is larger than 8MB.");
  }

  return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
}

function buildTryOnPrompt({ garmentType, prompt, backgroundPreservation, changeStrength }) {
  const garmentLabel = typeof garmentType === "string" && garmentType.trim() ? garmentType.trim() : "clothing item";
  const userPrompt = typeof prompt === "string" ? prompt.trim() : "";

  const basePrompt = [
    "Create a realistic virtual try-on photo edit.",
    "Use image 1 as the person identity and body.",
    "Use image 2 as the garment reference.",
    `Dress the person in image 1 with the ${garmentLabel} style seen in image 2.`,
    "Preserve the same person face, body proportions, skin tone, and a natural pose.",
    "Keep the output photorealistic and coherent.",
    "The reference image provides style and garment details, but identity must remain the person from image 1.",
  ];

  if (backgroundPreservation === "strict") {
    basePrompt.push("Keep the original background from image 1 unchanged.");
  } else if (backgroundPreservation === "balanced") {
    basePrompt.push("Prefer preserving the original background from image 1 with only minimal adjustments if needed.");
  } else {
    basePrompt.push("Background can adapt moderately for realism while keeping focus on the person.");
  }

  if (changeStrength >= 85) {
    basePrompt.push("Only modify the requested garment area and keep everything else unchanged.");
  } else if (changeStrength >= 65) {
    basePrompt.push("Prioritize garment replacement while preserving most non-garment details.");
  } else {
    basePrompt.push("Allow moderate adaptation beyond the garment for a coherent visual result.");
  }

  if (userPrompt) {
    basePrompt.push(`Additional user request: ${userPrompt}`);
  }

  return basePrompt.join(" ");
}

async function callOpenAiImageEditsJson({ model, prompt, size, images }) {
  const openAiResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      output_format: "png",
      images,
    }),
  });

  const responseBody = await openAiResponse.json().catch(() => ({}));
  return { ok: openAiResponse.ok, status: openAiResponse.status, responseBody };
}

async function callOpenAiImageEditsMultipart({ model, prompt, size, personImage, referenceImage, imageFieldName }) {
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("output_format", "png");
  formData.append(
    imageFieldName,
    new Blob([personImage.buffer], { type: personImage.mimeType }),
    `person.${personImage.extension}`
  );
  formData.append(
    imageFieldName,
    new Blob([referenceImage.buffer], { type: referenceImage.mimeType }),
    `reference.${referenceImage.extension}`
  );

  const openAiResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  const responseBody = await openAiResponse.json().catch(() => ({}));
  return { ok: openAiResponse.ok, status: openAiResponse.status, responseBody };
}

function getOpenAiErrorMessage(responseBody, statusCode) {
  const apiMessage = responseBody?.error?.message;
  const apiParam = responseBody?.error?.param;
  if (apiMessage && apiParam) {
    return `${apiMessage} (param: ${apiParam})`;
  }
  return apiMessage || `OpenAI request failed with HTTP ${statusCode}`;
}

function buildUserFriendlyErrorMessage(rawMessage) {
  if (typeof rawMessage !== "string") {
    return "Unexpected server error while generating image.";
  }

  if (/param:\s*model/i.test(rawMessage) || /invalid.*model/i.test(rawMessage)) {
    return "Generation failed due to an invalid OPENAI_IMAGE_MODEL value. Use gpt-image-1 or unset OPENAI_IMAGE_MODEL to use the default.";
  }

  if (
    /did not match (the )?expected pattern/i.test(rawMessage) ||
    /invalid header value/i.test(rawMessage)
  ) {
    return "Generation failed due to invalid request formatting. Verify OPENAI_API_KEY contains only the raw key value (no quotes, no Bearer prefix, no whitespace).";
  }

  return rawMessage;
}

async function runImageEditAttempt(label, makeRequest) {
  try {
    const requestResult = await makeRequest();
    return { label, ...requestResult };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      responseBody: { error: { message: error?.message || "Image edit request failed before reaching OpenAI." } },
    };
  }
}

async function generateTryOnImage({
  personImageDataUrl,
  referenceImageDataUrl,
  garmentType,
  outputAspectRatio,
  backgroundPreservation,
  changeStrength,
  prompt,
}) {
  const apiKeyValidationError = getOpenAiApiKeyValidationError(OPENAI_API_KEY);
  if (apiKeyValidationError) {
    throw new Error(apiKeyValidationError);
  }

  const personImage = parseImageDataUrl(personImageDataUrl);
  const referenceImage = parseImageDataUrl(referenceImageDataUrl);
  const normalizedAspectRatio = normalizeAspectRatio(outputAspectRatio);
  const normalizedBackgroundPreservation = normalizeBackgroundPreservation(backgroundPreservation);
  const normalizedChangeStrength = normalizeChangeStrength(changeStrength);
  const generationPrompt = buildTryOnPrompt({
    garmentType,
    prompt,
    backgroundPreservation: normalizedBackgroundPreservation,
    changeStrength: normalizedChangeStrength,
  });
  const size = ASPECT_RATIO_SIZE_MAP[normalizedAspectRatio];
  const model = normalizeImageModel(OPENAI_IMAGE_MODEL);
  const personDataUrl = buildNormalizedImageDataUrl(personImage);
  const referenceDataUrl = buildNormalizedImageDataUrl(referenceImage);

  const attempts = [
    () =>
      runImageEditAttempt("JSON images[].image_url", () =>
        callOpenAiImageEditsJson({
          model,
          prompt: generationPrompt,
          size,
          images: [{ image_url: personDataUrl }, { image_url: referenceDataUrl }],
        })
      ),
    () =>
      runImageEditAttempt("JSON images[] data URLs", () =>
        callOpenAiImageEditsJson({
          model,
          prompt: generationPrompt,
          size,
          images: [personDataUrl, referenceDataUrl],
        })
      ),
    () =>
      runImageEditAttempt("Multipart image[]", () =>
        callOpenAiImageEditsMultipart({
          model,
          prompt: generationPrompt,
          size,
          personImage,
          referenceImage,
          imageFieldName: "image[]",
        })
      ),
    () =>
      runImageEditAttempt("Multipart image", () =>
        callOpenAiImageEditsMultipart({
          model,
          prompt: generationPrompt,
          size,
          personImage,
          referenceImage,
          imageFieldName: "image",
        })
      ),
  ];

  let responseBody;
  const attemptErrors = [];
  for (const attempt of attempts) {
    const attemptResult = await attempt();
    if (attemptResult.ok) {
      responseBody = attemptResult.responseBody;
      break;
    }

    const errorMessage = getOpenAiErrorMessage(attemptResult.responseBody, attemptResult.status);
    attemptErrors.push(`${attemptResult.label}: ${errorMessage}`);
  }

  if (!responseBody) {
    throw new Error(`OpenAI image edit failed. ${attemptErrors.join(" | ")}`);
  }

  const generatedImage = responseBody?.data?.[0];
  const base64Image = generatedImage?.b64_json;
  if (base64Image) {
    return `data:image/png;base64,${base64Image}`;
  }

  const imageUrl = generatedImage?.url;
  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`OpenAI returned an image URL but it could not be downloaded (HTTP ${imageResponse.status}).`);
    }

    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
  }

  throw new Error("OpenAI did not return an image.");
}

async function handleTryOnRequest(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  const personImageDataUrl = payload?.personImageDataUrl;
  const referenceImageDataUrl = payload?.referenceImageDataUrl;

  if (!personImageDataUrl || !referenceImageDataUrl) {
    sendJson(response, 400, { error: "Both personImageDataUrl and referenceImageDataUrl are required." });
    return;
  }

  try {
    const resultImageDataUrl = await generateTryOnImage(payload);
    sendJson(response, 200, { resultImageDataUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    sendJson(response, 500, { error: buildUserFriendlyErrorMessage(message) });
  }
}

async function handleRequest(request, response) {
  if (!request.url) {
    sendJson(response, 400, { error: "Bad Request" });
    return;
  }

  const url = new URL(request.url, "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime())
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/vinted-garments") {
    const category = normalizeVintedCategory(url.searchParams.get("category"));
    const limit = normalizeVintedLimit(url.searchParams.get("limit"));

    try {
      const result = await fetchVintedGarments(category, limit);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 502, { error: error?.message || "Failed to load garments from Vinted." });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/vinted-image-data-url") {
    const imageUrl = url.searchParams.get("url");
    if (!imageUrl) {
      sendJson(response, 400, { error: "Missing required query parameter: url" });
      return;
    }

    try {
      const dataUrl = await fetchImageDataUrlFromRemote(imageUrl);
      sendJson(response, 200, { dataUrl });
    } catch (error) {
      const message = error?.message || "Failed to load selected Vinted image.";
      const statusCode = /allowed|missing|required/i.test(message) ? 400 : 502;
      sendJson(response, statusCode, { error: message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/virtual-try-on") {
    await handleTryOnRequest(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStaticFile(url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Method Not Allowed" });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { error: error.message || "Internal Server Error" });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
