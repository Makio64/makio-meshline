import { useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react'
import { useThree } from '@react-three/fiber'
import { MeshLine as MeshLineCore } from 'makio-meshline'

function applyBuildOptions( line, options ) {
	const { dash, join, points, ...configureOptions } = options
	const linePoints = points ?? configureOptions.lines

	line.configure( {
		...configureOptions,
		lines: linePoints,
		transparent: configureOptions.transparent || configureOptions.opacity < 1,
	} )

	line.dash( dash )
	if ( join ) line.join( join )
	return line
}

export const MeshLine = forwardRef( function MeshLine( {
	points,
	lines,
	segments,
	closed = false,
	lineWidth = 0.1,
	color = 0xffffff,
	vertexColors,
	widthCallback,
	gradientColor,
	dash,
	map,
	mapOffset,
	alphaMap,
	opacity = 1,
	alphaTest = 0,
	transparent = false,
	wireframe = false,
	shadow = false,
	sizeAttenuation = true,
	join,
	smoothSharpBends = true,
	smoothSharpBendsAlpha,
	smoothSharpBendsThreshold,
	dpr,
	frustumCulled = true,
	verbose = false,
	renderWidth,
	renderHeight,
	dynamic,
	gpuPositionNode,
	usage,
	instanceCount,
	needsUV,
	needsWidth,
	needsProgress,
	needsPrevious,
	needsNext,
	needsSide,
	needsVertexColor,
	widthFn,
	normalFn,
	colorFn,
	opacityFn,
	gradientFn,
	uvFn,
	dashFn,
	positionFn,
	previousFn,
	nextFn,
	fragmentColorFn,
	fragmentAlphaFn,
	discardFn,
	vertexFn,
	updateBounding = false,
	onReady,
	...props
}, ref ) {
	const previousClosedRef = useRef( closed )
	const size = useThree( state => state.size )
	const linePoints = points ?? lines
	const resolvedRenderWidth = renderWidth ?? size.width
	const resolvedRenderHeight = renderHeight ?? size.height

	const line = useMemo( () => {
		const line = new MeshLineCore()
		applyBuildOptions( line, {
			points: linePoints,
			segments,
			closed,
			vertexColors,
			color,
			lineWidth,
			widthCallback,
			sizeAttenuation,
			gradientColor,
			dash,
			map,
			mapOffset,
			alphaMap,
			opacity,
			alphaTest,
			transparent,
			wireframe,
			shadow,
			join,
			smoothSharpBends,
			smoothSharpBendsAlpha,
			smoothSharpBendsThreshold,
			dpr,
			frustumCulled,
			verbose,
			renderWidth: resolvedRenderWidth,
			renderHeight: resolvedRenderHeight,
			dynamic,
			gpuPositionNode,
			usage,
			instanceCount,
			needsUV,
			needsWidth,
			needsProgress,
			needsPrevious,
			needsNext,
			needsSide,
			needsVertexColor,
			positionFn,
			previousFn,
			nextFn,
			widthFn,
			normalFn,
			colorFn,
			gradientFn,
			opacityFn,
			dashFn,
			uvFn,
			vertexFn,
			fragmentColorFn,
			fragmentAlphaFn,
			discardFn,
		} )
		line.build()
		previousClosedRef.current = closed
		return line
	}, [segments, sizeAttenuation, widthCallback, vertexColors, join, smoothSharpBends, smoothSharpBendsAlpha,
		smoothSharpBendsThreshold, dynamic, gpuPositionNode, usage, instanceCount, needsUV, needsWidth,
		needsProgress, needsPrevious, needsNext, needsSide, needsVertexColor, positionFn, previousFn, nextFn,
		widthFn, normalFn, colorFn, gradientFn, opacityFn, dashFn, uvFn, vertexFn, fragmentColorFn,
		fragmentAlphaFn, discardFn] )

	useEffect( () => {
		return () => line.dispose()
	}, [line] )

	useEffect( () => {
		onReady?.( line )
	}, [line, onReady] )

	useEffect( () => {
		if ( !linePoints ) return

		if ( previousClosedRef.current !== closed ) {
			line.lines( linePoints, closed )
			previousClosedRef.current = closed
			return
		}

		line.setPositions( linePoints, updateBounding )
	}, [line, linePoints, closed, updateBounding] )

	useEffect( () => {
		line.lineWidth( lineWidth )
		line.color( color )
		line.transparent( transparent || opacity < 1 )
		line.opacity( opacity )
		line.alphaTest( alphaTest )
		line.wireframe( wireframe )
		line.shadow( shadow )
		line.setFrustumCulled( frustumCulled )
		line.verbose( verbose )
		if ( dpr !== undefined ) line.dpr( dpr )
	}, [line, lineWidth, color, opacity, alphaTest, transparent, wireframe, shadow, frustumCulled, verbose, dpr] )

	useEffect( () => {
		line.gradientColor( gradientColor ?? null )
	}, [line, gradientColor] )

	useEffect( () => {
		line.map( map ?? null )
	}, [line, map] )

	useEffect( () => {
		line.alphaMap( alphaMap ?? null )
	}, [line, alphaMap] )

	useEffect( () => {
		line.mapOffset( mapOffset ?? null )
	}, [line, mapOffset] )

	useEffect( () => {
		line.dash( dash )
	}, [line, dash] )

	useEffect( () => {
		line.renderSize( resolvedRenderWidth, resolvedRenderHeight )
		line.resize( resolvedRenderWidth, resolvedRenderHeight )
	}, [line, resolvedRenderWidth, resolvedRenderHeight] )

	useImperativeHandle( ref, () => line, [line] )

	return <primitive {...props} object={line} dispose={null} />
} )
