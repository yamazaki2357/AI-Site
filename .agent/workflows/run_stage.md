---
description: Run a specific stage of the content generation pipeline
---
To run a specific stage of the pipeline, use the following commands.

### Researcher
Run the researcher to gather information about a keyword.
```bash
node automation/researcher/index.js --keyword "Your Keyword Here"
```

### Generator
Run the generator to create an article from researched data.
(Note: Generator typically relies on `data/candidates.json` state, so running it standalone requires existing researched data)
```bash
node automation/generator/index.js
```

### Publisher
Run the publisher to publish generated articles.
```bash
node automation/publisher/index.js
```
