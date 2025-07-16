---
outline: false
pageClass: example-page
---

# Basic Examples

This demo displays 16 different MeshLine configurations each demonstrating specific features

<iframe src="https://meshlines.netlify.app/examples/basic?noMenu" width="100%" height="600" style="border: 1px solid #ddd; border-radius: 8px;"></iframe>

## Code Example

Here's how one of these configurations is created:

```javascript
import { MeshLine, circlePositions } from 'meshline'

// Create a dashed line with gradient
const line = new MeshLine()
  .lines( circlePositions(64) )
  .isClose( true )
  .color( 0x00FF00 )
  .gradientColor( 0xFF0000 )
  .lineWidth( 0.4 )
  .dashes( 10, 0.7 )
  .build()

scene.add( line )
```

## Animation Reveal

The examples include animated reveal effects where lines draw in and out sequentially, demonstrating dynamic line manipulation capabilities.

```javascript
import { animate } from 'animejs'
import { uniform, Fn, step, uv } from 'three/tsl'
import { MeshLine } from 'meshline'

// Create uniforms for animation control
const line = new MeshLine()
  .lines( circlePositions(64) )
  .isClose( true )
  .needsUV( true )
  .color( 0xff3300 )
  .build()

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
  // reset value
  line.percent1.value = -0.01
  line.percent2.value = 1.01
  
  animate( line.percent1, {  duration: 1,  value: 1.01,  ease: 'easeOut'  } )
  
  // Draw out animation after delay
  animate( line.percent2, {  duration: 1,  value: -0.01,  delay: 3,  ease: 'easeOut',
    onComplete: () => animateReveal() // Loop
  } )
}

animateReveal()
```

This technique uses TSL's `discardFn` hook with UV coordinates to progressively reveal/hide the line, creating smooth draw-in and draw-out effects.

** Note ** the usage of `.needsUV( true )` to build the uv on the lines so we can access it in the discardFn we declared.