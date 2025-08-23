---
outline: false
pageClass: example-page
---

# Basic Examples

This demo displays 16 different MeshLine configurations each demonstrating specific features or combinaison

<iframe src="https://meshlines.netlify.app/examples/basic?noUI" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>


## How to make a reveal animation

This example include an animated reveal effects where lines draw in and out sequentially.

This effect is managed using discardFn to discard the value before/after two percentage uniforms.

```javascript
import { animate } from 'animejs'
import { uniform, Fn, step, uv } from 'three/tsl'
import { MeshLine } from 'makio-meshline'

// Create uniforms for animation control
const line = new MeshLine()
  .lines( circlePositions(64) )
  .closed( true )
  .needsUV( true )
  .color( 0xff3300 )

// Add animation uniforms
line.percent1 = uniform( 0 )
line.percent2 = uniform( 1 )

// Use discardFn to control line visibility
line.discardFn( Fn( () => {
  return 
    step( uv().x, line.percent1 ).mul(        // discard uv.x before percent1
    step( uv().x.oneMinus(), line.percent2 )  // discard uv.x after percent2
  ).lessThan( 0.00001 )
} ) )

// Animate the reveal
function animateReveal() {
  animate( line.percent1, {  duration: 1,  value: [-0.01, 1.01],  ease: 'easeOut'  } )
  animate( line.percent2, {  duration: 1,  value: [1.01, -0.01],  delay: 3,  ease: 'easeOut',
    onComplete: () => animateReveal() // Loop
  } )
}

animateReveal()
```

This technique uses TSL's `discardFn` hook with UV coordinates to progressively reveal/hide the line, creating smooth draw-in and draw-out effects.

**Note** the usage of `.needsUV( true )` to build the uv on the lines so we can access it in the discardFn we declared.

**Note2** this examples is not optimized as each Meshline is independant, ideally it'll be better to use instancing.