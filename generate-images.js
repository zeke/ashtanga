import Replicate from "replicate";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Function to get available style images
async function getAvailableStyles() {
  const stylesDir = "styles";
  const files = await fs.readdir(stylesDir);
  return files
    .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))
    .map(file => ({
      name: file,
      path: path.join(stylesDir, file)
    }));
}

// Function to prompt user for style selection
async function promptForStyle(styles) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("\nAvailable style images:");
  styles.forEach((style, index) => {
    console.log(`  ${index + 1}. ${style.name}`);
  });

  return new Promise((resolve) => {
    rl.question("\nSelect a style (enter number): ", (answer) => {
      rl.close();
      const selection = parseInt(answer, 10) - 1;
      if (selection >= 0 && selection < styles.length) {
        resolve(styles[selection]);
      } else {
        console.error("Invalid selection. Using first style.");
        resolve(styles[0]);
      }
    });
  });
}

// Get style image path from command line arg or prompt user
let styleImagePath;
const styleArg = process.argv[2];

// Show help if requested
if (styleArg === '--help' || styleArg === '-h') {
  console.log(`
Usage: node generate-images.js [style-image]

Arguments:
  style-image    Optional. Name of style image from styles/ directory,
                 or full path to a style image file.
                 If not provided, you'll be prompted to select interactively.

Examples:
  node generate-images.js                    # Interactive mode
  node generate-images.js scarry.png         # Use specific style from styles/
  node generate-images.js /path/to/style.png # Use custom style path
`);
  process.exit(0);
}

if (styleArg) {
  // Check if it's a full path or just a filename
  if (styleArg.includes('/') || styleArg.includes('\\')) {
    styleImagePath = styleArg;
  } else {
    styleImagePath = path.join("styles", styleArg);
  }
  console.log(`Using style: ${styleImagePath}`);
} else {
  // Interactive mode
  const availableStyles = await getAvailableStyles();
  if (availableStyles.length === 0) {
    console.error("No style images found in styles/");
    process.exit(1);
  }
  const selectedStyle = await promptForStyle(availableStyles);
  styleImagePath = selectedStyle.path;
  console.log(`Selected style: ${selectedStyle.name}`);
}

// Verify the style image exists
try {
  await fs.access(styleImagePath);
} catch (error) {
  console.error(`Style image not found: ${styleImagePath}`);
  process.exit(1);
}

// Read and convert style reference image to data URL
console.log("Loading style reference image...");
const styleImageBuffer = await fs.readFile(styleImagePath);
const base64Image = styleImageBuffer.toString('base64');
const styleImageDataUrl = `data:image/jpeg;base64,${base64Image}`;
console.log(`Style image loaded\n`);

// Function to sanitize filename
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Extract style name from path and slugify it
const styleBasename = path.basename(styleImagePath, path.extname(styleImagePath));
const slugifiedStyleName = sanitizeFilename(styleBasename);

// Read poses data
const posesData = JSON.parse(
  await fs.readFile("poses.json", "utf-8")
);

// Read prompt template
const promptTemplate = await fs.readFile("prompt-template.txt", "utf-8");

// Create timestamped directory with style name
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "")
  .replace("T", "");
const outputDir = path.join("images", `${timestamp}-${slugifiedStyleName}`);
await fs.mkdir(outputDir, { recursive: true });

console.log(`Output directory: ${outputDir}\n`);

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
