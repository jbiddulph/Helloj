# AI Virtual Try-On Web App

This repository contains a vanilla HTML/CSS/JavaScript app with a lightweight Node.js backend for AI-powered
virtual try-on generation.

## Features

- Split-screen UI for:
  - user photo (upload or camera capture)
  - outfit reference image (upload or camera capture)
- OpenAI image edit integration to generate try-on output
- Generated image preview in-app
- Lightweight Node.js server using built-in modules
- Health endpoint at `GET /api/health`
- Try-on endpoint at `POST /api/virtual-try-on`

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   # Optional override:
   # export OPENAI_IMAGE_MODEL="gpt-image-1"
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` in your browser.
