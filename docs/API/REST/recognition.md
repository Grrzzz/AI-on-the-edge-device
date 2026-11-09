[Overview](_OVERVIEW.md) 

## REST API Endpoint: `api/recognition`

`http://IP-ADDRESS/api/recognition`

Result of the last fully completed image recognition cycle as JSON (replaces the former HTML page `recognition_details`).

---

### General Information

* **HTTP Method**: `GET`
* **Content-Type**: `application/json`
* **Cache Control**: `no-cache`

---

### Response

```json
{
  "api_name": "recognition:v3",
  "state": "Idle - Waiting For Autostart",
  "ready": true,
  "image": "/img_tmp/alg_roi.jpg",
  "sequences": [
    {
      "name": "main",
      "rawValue": "00530.0080",
      "actualValue": "530.0080",
      "digit":  { "enabled": true, "rois": [ { "name": "d1", "valid": true, "value": "5", "image": "/img_tmp/d1_org.jpg" } ] },
      "analog": { "enabled": true, "rois": [ { "name": "a1", "valid": false } ] }
    }
  ]
}
```

* `ready` is `false` while the device is not initialized, a cycle is running or no cycle has finished yet. Then only `api_name`, `state` and `ready` are returned.
* A ROI with `"valid": false` has no CNN result and no image.
* `enabled: false` means the digit / analog recognition is switched off in the configuration; `rois` is empty then.

### Alignment, confidence and ROI rectangle (WebUI picture animation)

```json
{ "alignment": { "rawImage": "/img_tmp/raw.jpg", "ok": true, "rotation": -3.2, "dx": 22, "dy": -16, "scale": 1,
                 "markers": [ { "x": 240, "y": 312, "w": 56, "h": 34 } ] },
  "sequences": [ { "digit": { "rois": [ { "name": "main_dig1", "valid": true, "value": "4.0", "confidence": 98,
                                           "rect": { "x": 93, "y": 167, "w": 30, "h": 54 } } ] } } ] }
```

* `alignment` (last cycle, only if the raw image is available): the aligned image (`/img_tmp/alg.jpg`) is the raw image (`rawImage`) **rotated by `rotation` degrees around the image center (positive is clockwise) and then shifted by `dx`, `dy` pixels**. `rotation` is the initial rotation plus the correction of the alignment, `markers` are the reference markers in the aligned image. `ok: false`: the alignment failed
* per ROI: `confidence` (0 to 100; 90 or more is `ok`, 60 or more `uncertain`, below that `low`; missing for models without a confidence; for the class100 models, which end without softmax, the device applies a softmax to the outputs: probability of the winning class and its two neighbors on each side) and `rect` (position and size in the aligned image, analog ROIs included)
* `/img_tmp/raw.jpg` is the raw camera image of the last cycle (kept in RAM, about 190 KB of PSRAM)

See also [live](live.md) for the same data while the cycle is running.
