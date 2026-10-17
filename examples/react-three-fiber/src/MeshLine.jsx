import { useThree } from '@react-three/fiber'
import { MeshLine as MeshLineCore, straightLine } from 'makio-meshline'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

const DEFAULT_JOIN = Object.freeze( { type: 'miter', limit: 4, segments: 8, inner: 'exact', fold: 'geometry' } )
const DEFAULT_CAP = Object.freeze( { type: 'butt', segments: 8 } )

function createMeshLine( options ) {
	return new MeshLineCore( options ).build()
}

export const MeshLine = forwardRef( function MeshLine( {
	// Geometry and topology
	points,
	lines,
	segments,
	closed = false,
	surface = false,
	join,
	miterLimit,
	cap,
	smoothSharpBends = false,
	smoothSharpBendsAlpha,
	smoothSharpBendsThreshold,
	updateBounding = false,

	// Appearance
	lineWidth = 0.3,
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
	receiveShadow = false,
	sizeAttenuation = true,
	antialias = false,
	dpr,
	frustumCulled,
	verbose = false,
	renderWidth,
	renderHeight,

	// Buffer layout, GPU positions, and instancing
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

	// TSL hooks
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

	// R3F lifecycle
	onReady,
	...props
}, ref ) {
	const synchronizedLineRef = useRef( false )
	const notifiedLineRef = useRef( null )
	const disposalGenerationRef = useRef( 0 )
	const size = useThree( state => state.size )
	const resolvedSegments = segments ?? 1
	const generatedPoints = useMemo( () => straightLine( 1, resolvedSegments ), [resolvedSegments] )
	const linePoints = points ?? lines ?? generatedPoints
	// A hidden canvas measures 0×0, and renderSize() rejects a zero size, so
	// clamp to one pixel as resize() does.
	const resolvedRenderWidth = Math.max( 1, renderWidth ?? size.width )
	const resolvedRenderHeight = Math.max( 1, renderHeight ?? size.height )
	const resolvedFrustumCulled = frustumCulled ?? (
		sizeAttenuation !== false &&
		!gpuPositionNode &&
		!positionFn &&
		!previousFn &&
		!nextFn &&
		!widthFn &&
		!normalFn &&
		!vertexFn
	)

	// Structural options rebuild the existing facade. Keeping them separate from
	// live uniforms makes object identity, refs, and scene attachments stable.
	const structuralOptions = useMemo( () => ( {
		segments: resolvedSegments,
		closed,
		surface,
		vertexColors: vertexColors ?? null,
		widthCallback: widthCallback ?? null,
		sizeAttenuation,
		antialias,
		join: join ?? DEFAULT_JOIN,
		cap: cap ?? DEFAULT_CAP,
		smoothSharpBends,
		smoothSharpBendsAlpha: smoothSharpBendsAlpha ?? 0.001,
		smoothSharpBendsThreshold: smoothSharpBendsThreshold ?? -0.5,
		dynamic: dynamic ?? false,
		gpuPositionNode: gpuPositionNode ?? null,
		usage,
		instanceCount: instanceCount ?? -1,
		needsUV: needsUV ?? false,
		needsWidth: needsWidth ?? false,
		needsProgress: needsProgress ?? false,
		needsPrevious: needsPrevious ?? !gpuPositionNode,
		needsNext: needsNext ?? !gpuPositionNode,
		needsSide: needsSide ?? false,
		needsVertexColor: needsVertexColor ?? false,
		positionFn: positionFn ?? null,
		previousFn: previousFn ?? null,
		nextFn: nextFn ?? null,
		widthFn: widthFn ?? null,
		normalFn: normalFn ?? null,
		colorFn: colorFn ?? null,
		gradientFn: gradientFn ?? null,
		opacityFn: opacityFn ?? null,
		dashFn: dashFn ?? null,
		uvFn: uvFn ?? null,
		vertexFn: vertexFn ?? null,
		fragmentColorFn: fragmentColorFn ?? null,
		fragmentAlphaFn: fragmentAlphaFn ?? null,
		discardFn: discardFn ?? null,
		frustumCulled: resolvedFrustumCulled,
	} ), [
		resolvedSegments,
		closed,
		surface,
		vertexColors,
		widthCallback,
		sizeAttenuation,
		antialias,
		join,
		cap,
		smoothSharpBends,
		smoothSharpBendsAlpha,
		smoothSharpBendsThreshold,
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
		resolvedFrustumCulled,
	] )

	const liveOptions = useMemo( () => ( {
		lineWidth,
		color,
		gradientColor: gradientColor ?? null,
		dash,
		miterLimit,
		map: map ?? null,
		mapOffset: mapOffset ?? null,
		alphaMap: alphaMap ?? null,
		opacity,
		alphaTest,
		transparent: transparent || opacity < 1 || alphaMap != null,
		wireframe,
		shadow,
		receiveShadow,
		dpr,
		verbose,
	} ), [
		lineWidth,
		color,
		gradientColor,
		dash,
		miterLimit,
		map,
		mapOffset,
		alphaMap,
		opacity,
		alphaTest,
		transparent,
		wireframe,
		shadow,
		receiveShadow,
		dpr,
		verbose,
	] )

	const renderSize = useMemo( () => ( {
		renderWidth: resolvedRenderWidth,
		renderHeight: resolvedRenderHeight,
	} ), [resolvedRenderWidth, resolvedRenderHeight] )
	const latestLiveOptionsRef = useRef( liveOptions )
	const latestRenderSizeRef = useRef( renderSize )
	latestLiveOptionsRef.current = liveOptions
	latestRenderSizeRef.current = renderSize

	const [line] = useState( () => createMeshLine( {
		lines: linePoints,
		...structuralOptions,
		...liveOptions,
		...renderSize,
	} ) )

	useEffect( () => {
		disposalGenerationRef.current += 1
		return () => {
			const generation = ++disposalGenerationRef.current
			queueMicrotask( () => {
				if ( disposalGenerationRef.current === generation ) line.dispose()
			} )
		}
	}, [line] )

	useEffect( () => {
		if ( !onReady || notifiedLineRef.current === line ) return
		notifiedLineRef.current = line
		onReady( line )
	}, [line, onReady] )

	useEffect( () => {
		if ( !synchronizedLineRef.current ) return
		line.setPositions( linePoints, updateBounding )
	}, [line, linePoints, updateBounding] )

	useEffect( () => {
		if ( !synchronizedLineRef.current ) return

		// Mark the pipeline dirty first so configure() batches surface, topology,
		// buffer-layout, and hook changes into one rebuild.
		line.positionFn( structuralOptions.positionFn )
		line.configure( {
			...structuralOptions,
			...latestLiveOptionsRef.current,
			...latestRenderSizeRef.current,
		} )
		line.dash( latestLiveOptionsRef.current.dash )
		line.rebuild()
	}, [line, structuralOptions] )

	useEffect( () => {
		if ( !synchronizedLineRef.current ) return

		line.lineWidth( liveOptions.lineWidth )
		line.color( liveOptions.color )
		line.transparent( liveOptions.transparent )
		line.opacity( liveOptions.opacity )
		line.alphaTest( liveOptions.alphaTest )
		line.wireframe( liveOptions.wireframe )
		line.shadow( liveOptions.shadow )
		line.setReceiveShadow( liveOptions.receiveShadow )
		line.gradientColor( liveOptions.gradientColor )
		line.map( liveOptions.map )
		line.alphaMap( liveOptions.alphaMap )
		line.mapOffset( liveOptions.mapOffset )
		line.dash( liveOptions.dash )
		if ( liveOptions.miterLimit !== undefined ) line.miterLimit( liveOptions.miterLimit )
		line.verbose( liveOptions.verbose )
		if ( liveOptions.dpr !== undefined ) line.dpr( liveOptions.dpr )
	}, [line, liveOptions] )

	useEffect( () => {
		if ( !synchronizedLineRef.current ) return
		// renderSize() preserves the dimensions for later rebuilds; resize()
		// updates the current material's resolution uniform immediately.
		line.renderSize( renderSize.renderWidth, renderSize.renderHeight )
		line.resize( renderSize.renderWidth, renderSize.renderHeight )
	}, [line, renderSize] )

	useImperativeHandle( ref, () => line, [line] )

	// Construction already applied every prop. Mark the object only after the
	// update effects above so they handle later changes, not the initial mount.
	useEffect( () => {
		synchronizedLineRef.current = true
		return () => {
			synchronizedLineRef.current = false
		}
	}, [line] )

	return <primitive {...props} object={line} dispose={null} />
} )
