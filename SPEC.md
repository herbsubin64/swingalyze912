
## Optional ANGLES payload (behind feature flag)
If `features.angles = true`, the analyzer **may** print a third line:
`__ANGLES__ { "spineTiltTop": <deg|null>, "spineTiltImpact": <deg|null>, "shaftTop": <deg|null>, "shaftImpact": <deg|null> }`

Server behavior:
- Includes `"angles"` field in the JSON response when present.
- No gates enforce angles yet.

Clients:
- Should render angles if present; otherwise hide that section.
