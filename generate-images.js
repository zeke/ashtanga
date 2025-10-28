import Replicate from "replicate";
import fs from "node:fs/promises";
import path from "node:path";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Read and convert style reference image to data URL
console.log("Loading style reference image...");
const styleImagePath = "images/_styles/flora.jpg";
const styleImageBuffer = await fs.readFile(styleImagePath);
const base64Image = styleImageBuffer.toString('base64');
const styleImageDataUrl = `data:image/jpeg;base64,${base64Image}`;
console.log(`Style image loaded\n`);

// Read poses data
const posesData = JSON.parse(
  await fs.readFile("poses.json", "utf-8")
);

// Read prompt template
const promptTemplate = await fs.readFile("prompt-template.txt", "utf-8");

// Create timestamped directory
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "")
  .replace("T", "");
const outputDir = path.join("images", timestamp);
await fs.mkdir(outputDir, { recursive: true });

console.log(`Output directory: ${outputDir}\n`);

// Function to sanitize filename
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Function to generate prompt from template
function generatePrompt(pose) {
  return promptTemplate
    .replace(/\{\{sanskrit\}\}/g, pose.sanskrit)
    .replace(/\{\{translation\}\}/g, pose.translation)
    .replace(/\{\{etymology\}\}/g, pose.etymology || "")
    .replace(/\{\{description\}\}/g, pose.description)
    .replace(/\{\{anatomical\}\}/g, pose.anatomical || "");
}

// Function to generate image for a single pose
async function generatePoseImage(pose, sectionName, index) {
  // Extract English name from translation (remove quotes and extra text)
  const englishName = pose.translation
    .replace(/^["']|["']$/g, '') // Remove quotes
    .split(' - ')[0] // Take first part before dash
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  const sanskritName = sanitizeFilename(pose.sanskrit);
  const paddedIndex = String(index).padStart(3, '0');

  console.log(`Generating image for ${pose.sanskrit}...`);

  try {
    const finalPrompt = generatePrompt(pose);

    const input = {
      prompt: finalPrompt,
      image_input: [styleImageDataUrl],
      aspect_ratio: "3:4",
      output_format: "jpg",
    };

    // Capture the prediction ID via progress callback
    let predictionId = null;
    const onProgress = (prediction) => {
      if (prediction.id && !predictionId) {
        predictionId = prediction.id;
      }
    };

    // Run the model with progress callback
    const output = await replicate.run(
      "google/nano-banana",
      { input },
      onProgress
    );

    // Get the output image URL
    const imageUrl = typeof output === 'string' ? output : output[0];

    // Build filename with actual prediction ID
    const filename = `${paddedIndex}-${sanskritName}-${englishName}-${predictionId}`;
    const filepath = path.join(outputDir, `${filename}.jpg`);

    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write the file to disk
    await fs.writeFile(filepath, buffer);

    console.log(`✓ Generated ${filename}.jpg`);

    return {
      sanskrit: pose.sanskrit,
      section: sectionName,
      filename: `${filename}.jpg`,
      filepath: filepath,
      success: true,
      predictionId,
    };
  } catch (error) {
    console.error(`✗ Failed to generate ${pose.sanskrit}:`, error.message);
    return {
      sanskrit: pose.sanskrit,
      section: sectionName,
      filename: `${paddedIndex}-${sanskritName}-${englishName}-error.jpg`,
      success: false,
      error: error.message,
    };
  }
}

// Collect all poses with index
const allPoses = [];
let poseIndex = 1;
for (const section of posesData.sections) {
  for (const pose of section.poses) {
    allPoses.push({
      pose,
      sectionName: section.name,
      index: poseIndex++
    });
  }
}

console.log(`Starting image generation for ${allPoses.length} poses...\n`);

// Generate all images in parallel
const results = await Promise.all(
  allPoses.map(({ pose, sectionName, index }) =>
    generatePoseImage(pose, sectionName, index)
  )
);

// Summary
const successful = results.filter((r) => r.success).length;
const failed = results.filter((r) => !r.success).length;

console.log("\n" + "=".repeat(50));
console.log("Generation Complete!");
console.log("=".repeat(50));
console.log(`Total poses: ${allPoses.length}`);
console.log(`Successful: ${successful}`);
console.log(`Failed: ${failed}`);

// Save results to JSON
const resultsData = {
  timestamp: new Date().toISOString(),
  outputDirectory: outputDir,
  total: allPoses.length,
  successful,
  failed,
  results: results,
};

const resultsPath = path.join(outputDir, "results.json");
await fs.writeFile(
  resultsPath,
  JSON.stringify(resultsData, null, 2)
);

console.log(`\nResults saved to ${resultsPath}`);

// List any failures
if (failed > 0) {
  console.log("\nFailed poses:");
  results
    .filter((r) => !r.success)
    .forEach((r) => {
      console.log(`  - ${r.sanskrit}: ${r.error}`);
    });
}
