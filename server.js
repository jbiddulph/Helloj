const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1.5";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
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
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
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
    sendJson(response, 500, { error: error.message });
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
