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

### Optional fields for the picture animation (WebUI)

The dashboard plays an animation when a cycle ends (taking image, raw image, rotation and alignment, regions, recognition). It works with the data above; the following optional fields enrich it. Without them the steps are skipped or approximated (the ROI geometry is then taken from the configuration, every recognized ROI counts as `ok`).

```json
{ "alignment": { "rawImage": "/img_tmp/raw.jpg", "rotation": 3.2, "scale": 0.93, "dx": -22, "dy": 16,
                 "markers": [ { "x": 240, "y": 312, "w": 56, "h": 34 } ] },
  "sequences": [ { "digit": { "rois": [ { "name": "d1", "valid": true, "value": "5", "confidence": 98, "rect": { "x": 93, "y": 183, "w": 30, "h": 54 } } ] } } ] }
```

* `alignment.rawImage`: camera image before the alignment; `rotation` (degrees), `scale`, `dx`, `dy`: pose of the raw image against the aligned image (`/img_tmp/alg.jpg`); `markers`: reference markers (aligned image)
* per ROI: `confidence` (0 to 100; 90 or more is `ok`, 60 or more `uncertain`, below that `low`) and `rect` (position and size in the aligned image)
