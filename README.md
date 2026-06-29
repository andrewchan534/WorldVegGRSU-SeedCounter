# Seed Counter Prototype

A browser-based seed counting prototype for seed bank workflows. The app runs locally in the browser with JavaScript and uses the user's uploaded photo or webcam capture to estimate the number of seeds in the image.

## Project Structure

- `seedcounter/`: deployable static web app folder.
- `seedcounter/index.html`: main Seed Counter page.
- `seedcounter/seedcounter.app.js`: app logic with a project-specific filename to avoid collisions with other tools.
- `seedcounter/seedcounter.styles.css`: app styles with a project-specific filename to avoid collisions with other tools.
- `index.html`, `seedcounter.html`: lightweight redirects to `seedcounter/` for local convenience and backward compatibility.
- `01_source_data/sample_photos/`: raw template/sample photos. The filename prefix is the correct seed count, for example `103 (2).jpg` means 103 seeds.
- `03_scripts/evaluate_samples.py`: local validation script for checking the current algorithm against the sample photos.

Technical folders such as `.git` and `.agents` are intentionally left in place.

## Local Use

Open `seedcounter/index.html` directly, or serve the folder locally and visit:

```text
http://127.0.0.1:8765/seedcounter/
```

Recommended photo conditions:

- White or light background.
- Even lighting.
- Seeds separated as much as possible.
- Seeds may touch, but should not overlap.

## Deployment

For folder-based Apache deployment, copy this folder into the web root:

- `seedcounter/`

The primary URL should be:

```text
https://genebank.worldveg.org/seedcounter/
```

The root `seedcounter.html` redirect can also be copied to the web root if the older URL should continue forwarding users to the folder-based app:

```text
https://genebank.worldveg.org/seedcounter.html
```

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
