[Overview](_OVERVIEW.md)

## REST API Endpoints: `api/flow/copy` and `api/flow/cutref`

Parametrization helpers (replace `/editflow`). Paths must start with `/config/` or `/img_tmp/`.

* `POST /api/flow/copy` body `{"in":"/img_tmp/marker1.jpg","out":"/config/marker1.jpg"}` copies a file on the SD card.
* `POST /api/flow/cutref` body `{"in":"/config/reference.jpg","out":"/img_tmp/marker1.jpg","x":10,"y":10,"dx":40,"dy":40}`
  cuts an area (e.g. an alignment marker) out of an image. Rejected with `403 E90` if the flow is not initialized and with
  `405 E91` while a cycle is processed on devices with 4 MB PSRAM.

Response: `{"ok":true,"code":"001","message":"Copy done"}`
