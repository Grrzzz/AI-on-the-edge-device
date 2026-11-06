[Overview](_OVERVIEW.md)

## REST API Endpoint: `api/fallback`

Read or set the Fallback Value of a number sequence. Replaces `/set_fallbackvalue`.

* `GET /api/fallback?sequence=main` returns `{"ok":true,"sequence":"main","value":"530.0080"}`
* `POST /api/fallback` with body `{"sequence":"main","value":"1234.5"}` sets the value and returns the new one.
  A value `>= 0` is taken as new Fallback Value, a value `< 0` takes the actual RAW value (if it is a valid number).

Errors (`{"ok":false,"code":"E..","message":".."}`): `400 E91` parameter missing, `403 E95` flow not initialized,
`404 E92` sequence not found, `409 E93` update rejected (see device log).
