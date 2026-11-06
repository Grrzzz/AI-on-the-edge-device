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
