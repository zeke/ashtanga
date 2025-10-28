import fs from 'node:fs/promises';

const data = JSON.parse(await fs.readFile('poses.json', 'utf-8'));

// Helper function to convert instructional language to observational
function toObservational(text) {
  return text
    // Remove instructional cues
    .replace(/engaged|engaging/gi, '')
    .replace(/lifting|lift/gi, 'lifts')
    .replace(/grounding|ground/gi, 'rests on the ground')
    .replace(/pressing|press/gi, 'presses')
    .replace(/drawing|draw/gi, 'draws')
    .replace(/reaching|reach/gi, 'reaches')
    .replace(/maintaining|maintain/gi, 'maintains')
    .replace(/creating|create/gi, 'creates')
    .replace(/forming|form/gi, 'forms')
    // Change active voice to passive/observational
    .replace(/(\w+ing)\s/g, (match, word) => {
      // Convert -ing words to present tense third person
      const base = word.slice(0, -3);
      return base + 's ';
    })
    // Clean up
    .replace(/\s+/g, ' ')
    .replace(/\.\s+\./g, '.')
    .trim();
}

// Update all anatomical descriptions
data.sections.forEach(section => {
  section.poses.forEach(pose => {
    if (pose.anatomical) {
      // Convert to observational if it contains instructional language
      if (pose.anatomical.match(/(engaged|lifting|grounding|pressing|drawing|reaching|maintaining)/i)) {
        const sentences = pose.anatomical.split('. ');
        const observational = sentences.map(s => {
          // Start with "The figure" or "The body" or continue with existing subject
          if (!s.match(/^(The|A|Both|One|Two)/)) {
            s = 'The figure ' + s.toLowerCase();
          }
          return s;
        }).join('. ');

        pose.anatomical = observational;
      }
    }
  });
});

await fs.writeFile('poses.json', JSON.stringify(data, null, 2));
console.log('Updated all anatomical descriptions to observational language');
