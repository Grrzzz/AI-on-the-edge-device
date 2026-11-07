[Overview](_OVERVIEW.md)

## REST API Endpoint: `api/live`

`GET http://IP-ADDRESS/api/live`

Progress of the running cycle: the data the process produces step by step. The WebUI uses it to follow the device with the picture animation of the dashboard (taking image, raw image, rotation and alignment, regions, results). The data of the last cycle stays available until the next cycle starts.

```json
{
  "api_name": "live:v1",
  "running": true,
  "state": "Digitization of Digit Recognition",
  "cycle": 842,
  "raw": true,
  "alignment": { "ok": true, "rawImage": "/img_tmp/raw.jpg", "rotation": -3.2, "dx": 22, "dy": -16, "scale": 1,
                 "markers": [ { "x": 240, "y": 312, "w": 56, "h": 34 } ] },
  "rois": [ { "seq": "main", "kind": "digit", "name": "main_dig1", "value": "4.0", "confidence": 98, "rejected": false } ]
}
```

| Field | Description |
|---|---|
| `running` | A cycle is being processed |
| `cycle` | Number of the cycle the data belongs to |
| `raw` | The raw camera image of this cycle is available at `/img_tmp/raw.jpg` |
| `alignment` | `null` until the alignment is done, then rotation and shift as described in [recognition](recognition.md) |
| `rois` | Results of the ROIs evaluated so far, in the order of the evaluation (digits, then analog). `value` as in `api/recognition`, `confidence` 0 to 100 (missing for models without), `rejected` for a bad fit (dig-cont) |

The aligned image (`/img_tmp/alg.jpg`) is available as soon as `alignment` is set; the ROI crops (`/img_tmp/<name>_org.jpg`) as soon as the ROI has a result.
