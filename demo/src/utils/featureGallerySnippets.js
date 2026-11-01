/** The code the inspector shows for each gallery cell, by title. */
export const SNIPPETS = {
	'Basic': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xce4257 )
  .lineWidth( 0.2 )`,
	'Width Hook': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .lineWidth( 0.65 )
  .widthFn( Fn( ( [width, progress] ) => {
    const phase = fract( progress.add( time.mul( 0.08 ) ) )
    return width.mul( sin( phase.mul( Math.PI ) ).mul( 0.8 ).add( 0.2 ) )
  } ) )`,
	'Open End': `new MeshLine()
  .lines( circlePositions( 64 ), false )
  .color( 0xfcd581 )
  .lineWidth( 0.3 )`,
	'Wireframe': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0x0a99ff )
  .lineWidth( 0.3 )
  .wireframe( true )`,
	'lineCoord Rim': `import { lineCoord, MeshLine } from 'makio-meshline'

new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0x38bdf8 )
  .lineWidth( 0.48 )
  .fragmentColorFn( Fn( ( [baseColor] ) => {
    const edge = lineCoord.y.abs()
    return mix( baseColor.mul( 0.28 ), vec3( 0.86, 0.98, 1 ), smoothstep( 0.35, 0.92, edge ) )
  } ) )`,
	'Dashed 8': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xf35b04 )
  .lineWidth( 0.3 )
  .dash( { count: 8, ratio: 0.6 } )`,
	'Dash Hook': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .dash( { count: 12, ratio: 0.42 } )
  .dashFn( Fn( ( [cyclePosition, progress] ) => {
    const offset = sin( progress.mul( Math.PI * 8 ).add( time.mul( 1.4 ) ) ).mul( 0.16 )
    return fract( cyclePosition.add( offset ) )
  } ) )`,
	'Long Dashes': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0x00ff80 )
  .lineWidth( 0.5 )
  .dash( { count: 6, ratio: 0.8 } )`,
	'UV Hook': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .map( signalTexture )
  .uvFn( Fn( ( [coords] ) => vec2( coords.x.add( time.mul( 0.12 ) ), coords.y ) ) )`,
	'Dash + Gradient': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0x00ff00 )
  .gradientColor( 0xff0000 )
  .dash( { count: 10, ratio: 0.7 } )`,
	'Gradient Hook': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xff00ff )
  .gradientColor( 0x00ffff )
  .gradientFn( Fn( ( [factor] ) => {
    const contour = factor.add( sin( factor.mul( Math.PI * 4 ).add( time.mul( 1.1 ) ) ).mul( 0.14 ) )
    return smoothstep( 0.22, 0.78, contour )
  } ) )`,
	'Gradient': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xffff00 )
  .gradientColor( 0x0000ff )
  .lineWidth( 0.3 )`,
	'Opacity Hook': `new MeshLine()
  .lines( circlePositions( 64 ), false )
  .transparent( true )
  .opacityFn( Fn( ( [alpha, progress] ) =>
    alpha.mul( smoothstep( 0, 0.14, progress ) ).mul( smoothstep( 0.86, 1, progress ).oneMinus() )
  ) )`,
	'Alpha Map': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xff00ff )
  .alphaMap( alphaTexture )`,
	'CSS Pixel Width': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .lineWidth( 5 )
  .sizeAttenuation( false )
  .autoResize()`,
	'Thick Dash + Gradient': `new MeshLine()
  .lines( circlePositions( 64 ), true )
  .color( 0xffffff )
  .gradientColor( 0xff0000 )
  .lineWidth( 0.5 )
  .dash( { count: 8, ratio: 0.5 } )`,
}
