import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { MeshLine as MeshLineCore } from 'makio-meshline'

export const MeshLine = forwardRef( function MeshLine( {
	points,
	closed = false,
	lineWidth = 0.1,
	color = 0xffffff,
	gradientColor,
	dash,
	map,
	opacity = 1,
	transparent = false,
	sizeAttenuation = true,
	widthFn,
	colorFn,
	opacityFn,
	gradientFn,
	uvFn,
	dashFn,
	positionFn,
	fragmentColorFn,
	fragmentAlphaFn,
	discardFn,
	vertexFn,
	...props
}, ref ) {
	const groupRef = useRef()
	const lineRef = useRef()

	useEffect( () => {
		const line = new MeshLineCore()
			.lines( points )
			.closed( closed )
			.lineWidth( lineWidth )
			.color( color )
			.sizeAttenuation( sizeAttenuation )

		if ( gradientColor != null ) line.gradientColor( gradientColor )
		if ( dash ) line.dash( dash )
		if ( map ) line.map( map )
		if ( transparent || opacity < 1 ) line.transparent( true ).opacity( opacity )

		if ( widthFn ) line.widthFn( widthFn )
		if ( colorFn ) line.colorFn( colorFn )
		if ( opacityFn ) line.opacityFn( opacityFn )
		if ( gradientFn ) line.gradientFn( gradientFn )
		if ( uvFn ) line.uvFn( uvFn )
		if ( dashFn ) line.dashFn( dashFn )
		if ( positionFn ) line.positionFn( positionFn )
		if ( fragmentColorFn ) line.fragmentColorFn( fragmentColorFn )
		if ( fragmentAlphaFn ) line.fragmentAlphaFn( fragmentAlphaFn )
		if ( discardFn ) line.discardFn( discardFn )
		if ( vertexFn ) line.vertexFn( vertexFn )

		line.build()
		lineRef.current = line
		groupRef.current.add( line )

		return () => {
			line.dispose()
			groupRef.current?.remove( line )
			lineRef.current = null
		}
	}, [points, closed, lineWidth, color, gradientColor, dash, map, opacity, transparent, sizeAttenuation,
		widthFn, colorFn, opacityFn, gradientFn, uvFn, dashFn, positionFn, fragmentColorFn, fragmentAlphaFn, discardFn, vertexFn] )

	useImperativeHandle( ref, () => lineRef.current, [] )

	return <group ref={groupRef} {...props} />
} )
