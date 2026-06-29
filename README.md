# Seed Counter Prototype

A browser-based seed counting prototype for seed bank workflows. The app runs locally in the browser with JavaScript and uses the user's uploaded photo or webcam capture to estimate the number of seeds in the image.

## Project Structure

- `index.html`, `seedcounter.html`, `app.js`, `styles.css`: static web app files kept at the repository root for simple Apache deployment.
- `01_source_data/sample_photos/`: raw template/sample photos. The filename prefix is the correct seed count, for example `103 (2).jpg` means 103 seeds.
- `03_scripts/evaluate_samples.py`: local validation script for checking the current algorithm against the sample photos.

Technical folders such as `.git` and `.agents` are intentionally left in place.

## Local Use

Open `index.html` directly, or serve the folder locally and visit:

```text
http://127.0.0.1:8765/
```

Recommended photo conditions:

- White or light background.
- Even lighting.
- Seeds separated as much as possible.
- Seeds may touch, but should not overlap.

## Deployment

For deployment to Apache at `https://genebank.worldveg.org/seedcounter.html`, copy these files into the web root:

- `seedcounter.html`
- `app.js`
- `styles.css`

The `01_source_data` and `03_scripts` folders are for development and validation. They do not need to be deployed for normal user use.

## Validation Snapshot

Using the current 10 sample images, the prototype produced this validation snapshot:

| File | Correct | Estimated | Diff |
| --- | ---: | ---: | ---: |
| 102.jpg | 102 | 105 | +3 |
| 103 (2).jpg | 103 | 105 | +2 |
| 103 (3).jpg | 103 | 103 | 0 |
| 103 (4).jpg | 103 | 104 | +1 |
| 103.jpg | 103 | 104 | +1 |
| 104.jpg | 104 | 100 | -4 |
| 108.jpg | 108 | 110 | +2 |
| 115.jpg | 115 | 115 | 0 |
| 55.jpg | 55 | 55 | 0 |
| 82.jpg | 82 | 83 | +1 |

Relative error ranged from about `-3.8%` to `+2.9%`, with a mean absolute percentage error of about `1.4%`.

Run the validation script after adding more template photos:

```powershell
python 03_scripts/evaluate_samples.py
```
