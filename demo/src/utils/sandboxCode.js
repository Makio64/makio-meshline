const INLINE_TYPES = ['strongAngle', 'zigzag', 'snake', 'helix']
const POSITION_HELPERS = {
	circle: 'circlePositions',
	sine: 'sineWavePositions',
	square: 'squarePositions',
}

export const generateSandboxCode = config => {
	let code = `import { MeshLine`

	if ( config.lineType === 'straight' ) {
		code += `, straightLine`
	} else if ( !INLINE_TYPES.includes( config.lineType ) ) {
		code += `, ${POSITION_HELPERS[config.lineType]}`
	}
	code += ` } from 'makio-meshline'\n\n`

	if ( config.lineType === 'zigzag' ) {
		code += `// Irregular sawtooth with per-tooth amplitude variation\n`
		code += `const teeth = 14, width = 20, baseAmp = 5\n`
		code += `const positions = new Float32Array( ( teeth + 1 ) * 3 )\n`
		code += `for ( let i = 0; i <= teeth; i++ ) {\n`
		code += `\tconst ampMod = 0.35 + 0.9 * Math.abs( Math.sin( i * 1.37 ) )\n`
		code += `\tpositions[i * 3] = -width / 2 + i * ( width / teeth )\n`
		code += `\tpositions[i * 3 + 1] = ( i % 2 === 0 ? -1 : 1 ) * baseAmp * ampMod\n`
		code += `}\n\n`
	} else if ( config.lineType === 'snake' ) {
		code += `// Serpentine path with swelling amplitude — smooth varied curves\n`
		code += `const segments = 240, width = 22\n`
		code += `const positions = new Float32Array( ( segments + 1 ) * 3 )\n`
		code += `for ( let i = 0; i <= segments; i++ ) {\n`
		code += `\tconst t = i / segments\n`
		code += `\tconst envelope = 0.3 + 0.7 * Math.sin( t * Math.PI )\n`
		code += `\tpositions[i * 3] = -width / 2 + width * t\n`
		code += `\tpositions[i * 3 + 1] = 5 * envelope * Math.sin( t * Math.PI * 5 )\n`
		code += `}\n\n`
	} else if ( config.lineType === 'helix' ) {
		code += `// 3D cylindrical helix spanning X with depth in Z\n`
		code += `const segments = ${config.segments}, width = 18, radius = 5.5, turns = 3.5\n`
		code += `const positions = new Float32Array( ( segments + 1 ) * 3 )\n`
		code += `for ( let i = 0; i <= segments; i++ ) {\n`
		code += `\tconst t = i / segments\n`
		code += `\tconst angle = t * Math.PI * 2 * turns\n`
		code += `\tpositions[i * 3] = -width / 2 + width * t\n`
		code += `\tpositions[i * 3 + 1] = Math.cos( angle ) * radius\n`
		code += `\tpositions[i * 3 + 2] = Math.sin( angle ) * radius\n`
		code += `}\n\n`
	} else if ( config.lineType === 'strongAngle' ) {
		code += `const controlPoints = [\n`
		code += `\t[-0.8, -0.45, 0],\n`
		code += `\t[-0.22, -0.12, 0],\n`
		code += `\t[-0.04, 0.78, 0],\n`
		code += `\t[0.03, -0.82, 0],\n`
		code += `\t[0.22, 0.1, 0],\n`
		code += `\t[0.8, 0.46, 0],\n`
		code += `]\n\n`
		code += `function createStrongAnglePositions( segments = 72, width = 18 ) {\n`
		code += `\tconst edgeCount = controlPoints.length - 1\n`
		code += `\tconst stepsPerEdge = Math.max( 1, Math.ceil( segments / edgeCount ) )\n`
		code += `\tconst positions = []\n\n`
		code += `\tfor ( let i = 0; i < edgeCount; i++ ) {\n`
		code += `\t\tconst start = controlPoints[i]\n`
		code += `\t\tconst end = controlPoints[i + 1]\n`
		code += `\t\tconst maxStep = i === edgeCount - 1 ? stepsPerEdge : stepsPerEdge - 1\n\n`
		code += `\t\tfor ( let step = 0; step <= maxStep; step++ ) {\n`
		code += `\t\t\tconst t = step / stepsPerEdge\n`
		code += `\t\t\tpositions.push(\n`
		code += `\t\t\t\t( start[0] + ( end[0] - start[0] ) * t ) * width,\n`
		code += `\t\t\t\t( start[1] + ( end[1] - start[1] ) * t ) * width,\n`
		code += `\t\t\t\t( start[2] + ( end[2] - start[2] ) * t ) * width\n`
		code += `\t\t\t)\n`
		code += `\t\t}\n`
		code += `\t}\n\n`
		code += `\treturn new Float32Array( positions )\n`
		code += `}\n\n`
		code += `const positions = createStrongAnglePositions( ${config.segments}, 18 )\n\n`
	} else if ( config.lineType === 'straight' ) {
		code += `const positions = straightLine( 20, ${config.segments} )\n\n`
	} else {
		code += `const positions = ${POSITION_HELPERS[config.lineType]}( `
		if ( config.lineType === 'circle' ) {
			code += `${config.segments}, 10`
		} else if ( config.lineType === 'sine' ) {
			code += `2, ${config.segments}, 1, 20`
		} else if ( config.lineType === 'square' ) {
			code += `20, ${config.segments}`
		}
		code += ` )\n\n`
	}

	code += `const line = new MeshLine()\n`
	code += `\t.lines( positions )\n`

	if ( config.closed ) {
		code += `\t.closed( true )\n`
	}

	code += `\t.color( 0x${config.color.substring( 1 )} )\n`
	code += `\t.lineWidth( ${config.lineWidth} )\n`

	if ( config.opacity !== 1 ) {
		code += `\t.opacity( ${config.opacity} )\n`
	}

	if ( config.opacity < 1 ) {
		code += `\t.transparent( true )\n`
	}

	if ( !config.sizeAttenuation ) {
		code += `\t.sizeAttenuation( false )\n`
		code += `\t.autoResize()\n`
	}

	if ( config.antialias ) {
		code += `\t.antialias( true )\n`
	}

	if ( config.useGradient ) {
		code += `\t.gradientColor( 0x${config.gradientColor.substring( 1 )} )\n`
	}

	if ( config.useDashes ) {
		code += `\t.dash( { count: ${config.dashCount}, ratio: ${config.dashRatio}`
		if ( config.dashOffset !== 0 ) {
			code += `, offset: ${config.dashOffset}`
		}
		code += ` } )\n`
	}

	if ( config.wireframe ) {
		code += `\t.wireframe( true )\n`
	}

	const joinType = config.joinType && config.joinType !== 'miter'
		? config.joinType
		: ( config.bevelJoins ? 'bevel' : 'miter' )
	const joinFold = config.joinFold === 'false' || config.joinFold === false
		? false
		: ( config.joinFold || 'geometry' )

	if ( joinType !== 'miter' || config.miterLimit !== 4 || joinFold !== 'geometry' ) {
		const joinFields = []
		if ( joinType !== 'miter' ) joinFields.push( `type: '${joinType}'` )
		if ( config.miterLimit !== 4 ) joinFields.push( `limit: ${config.miterLimit}` )
		if ( joinFold !== 'geometry' ) joinFields.push( `fold: ${joinFold === false ? 'false' : `'${joinFold}'`}` )
		code += `\t.join( { ${joinFields.join( ', ' )} } )\n`
	}

	if ( config.smoothSharpBends ) {
		code += `\t.smoothSharpBends( true )\n`
	}

	if ( config.smoothSharpBends && config.smoothSharpBendsAlpha !== 0.001 ) {
		code += `\t.smoothSharpBendsAlpha( ${config.smoothSharpBendsAlpha} )\n`
	}

	if ( config.smoothSharpBends && config.smoothSharpBendsThreshold !== -0.5 ) {
		code += `\t.smoothSharpBendsThreshold( ${config.smoothSharpBendsThreshold} )\n`
	}

	code += `\t.build()\n\n`
	code += `scene.add( line )`

	if ( config.animateDashes && config.useDashes ) {
		code += `\n\n// Animate the dash offset through the public API\n`
		code += `let dashOffset = ${config.dashOffset}\n\n`
		code += `function animate() {\n`
		code += `\tdashOffset -= 0.01\n`
		code += `\tline.dash( { count: ${config.dashCount}, ratio: ${config.dashRatio}, offset: dashOffset } )\n`
		code += `\trequestAnimationFrame( animate )\n}\n\nanimate()`
	}

	return code
}
