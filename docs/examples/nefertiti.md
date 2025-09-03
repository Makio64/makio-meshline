---
outline: false
pageClass: example-page
---

# Venus & David

Morph between two classical sculptures using MeshLine rings. The demo generates concentric contours for each model and morphs them with a GUI-controlled percent (no auto animation).

<iframe src="https://meshline-demo.makio.io/examples/venus-and-david?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## How it works

- Extract evenly spaced rings (XZ-plane) across a unified Y range for both models (David and Venus).
- Interpolate CPU-side between corresponding rings when the GUI slider changes.
- Update the MeshLine geometry efficiently with `geometry.setPositions()` for smooth morphing.

Note: Models can be swap as long as they share the same ring/segment counts.


