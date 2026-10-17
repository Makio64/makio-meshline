export const BILLBOARD_VERTICES_PER_POINT = 4
export const TRAIL_ATTRIBUTE_COMPONENTS = 6
export const TRAIL_DEPTH_STEP = 0.0001

export function createTrailPositions( pointCount, offsetX, offsetY ) {
	const positions = new Float32Array( pointCount * 3 )
	for ( let pointIndex = 0; pointIndex < pointCount; pointIndex++ ) {
		const offset = pointIndex * 3
		positions[offset] = offsetX
		positions[offset + 1] = offsetY
		// V2 removes consecutive duplicate points. A tiny depth-only seed keeps all
		// physical trail points alive while remaining visually coincident on mount.
		positions[offset + 2] = pointIndex * TRAIL_DEPTH_STEP
	}
	return positions
}

export function createTrailMeshLine( {
	MeshLine,
	lineArrays,
	lerp,
	Fn,
	attribute,
	vec4,
	blending,
} ) {
	const meshline = new MeshLine()
		.lines( lineArrays, false )
		.dynamic( true )
		.lineWidth( 0.002 )
		.widthCallback( ( t ) => {
			const edge = 0.2
			if ( t < edge ) return lerp( 0.05, 1, t / edge )
			if ( t > 1 - edge ) return lerp( 0.05, 1, ( 1 - t ) / edge )
			return 1
		} )
		.colorFn( Fn( ( [, progress] ) => {
			const lineColor = attribute( 'lineColor', 'vec3' )
			const lineEndColor = attribute( 'lineEndColor', 'vec3' )
			return vec4( lineColor.mix( lineEndColor, progress ), 0.6 )
		} ) )

	meshline.build()
	meshline.material.blending = blending

	const customAttributes = meshline.addVertexAttributes( {
		lineColor: 3,
		lineEndColor: 3,
	} )
	const expectedVertices = lineArrays.reduce(
		( count, line ) => count + line.length / 3 * BILLBOARD_VERTICES_PER_POINT,
		0,
	)
	if ( customAttributes.lineColor.count !== expectedVertices ) {
		throw new Error( `Unexpected trail vertex count: ${customAttributes.lineColor.count}` )
	}
	if ( customAttributes.lineColor.data.stride !== TRAIL_ATTRIBUTE_COMPONENTS ) {
		throw new Error( `Unexpected trail attribute stride: ${customAttributes.lineColor.data.stride}` )
	}

	return {
		meshline,
		customAttributes,
		customAttributeBuffer: customAttributes.lineColor.data,
	}
}

export function writeTrailAttributes( buffer, lines, pointCount ) {
	const verticesPerLine = pointCount * BILLBOARD_VERTICES_PER_POINT
	const totalVertices = lines.length * verticesPerLine
	const expectedLength = totalVertices * TRAIL_ATTRIBUTE_COMPONENTS
	if ( buffer.length !== expectedLength ) {
		throw new Error( `Trail attributes require ${expectedLength} values, received ${buffer.length}` )
	}

	for ( let lineIndex = 0; lineIndex < lines.length; lineIndex++ ) {
		const line = lines[lineIndex]
		const startVertex = lineIndex * verticesPerLine
		const endVertex = startVertex + verticesPerLine

		for ( let vertexIndex = startVertex; vertexIndex < endVertex; vertexIndex++ ) {
			const offset = vertexIndex * TRAIL_ATTRIBUTE_COMPONENTS
			buffer[offset] = line.startColor.r
			buffer[offset + 1] = line.startColor.g
			buffer[offset + 2] = line.startColor.b
			buffer[offset + 3] = line.endColor.r
			buffer[offset + 4] = line.endColor.g
			buffer[offset + 5] = line.endColor.b
		}
	}

	return totalVertices
}

export function stepTrailLine( line, targetX, targetY, pointCount, follow = 0.85 ) {
	const positions = line.positions
	for ( let pointIndex = pointCount - 1; pointIndex > 0; pointIndex-- ) {
		const offset = pointIndex * 3
		const previousOffset = offset - 3
		positions[offset] += ( positions[previousOffset] - positions[offset] ) * follow
		positions[offset + 1] += ( positions[previousOffset + 1] - positions[offset + 1] ) * follow
	}

	line.velocityX = ( line.velocityX + ( targetX - positions[0] ) * line.spring ) * line.friction
	line.velocityY = ( line.velocityY + ( targetY - positions[1] ) * line.spring ) * line.friction
	positions[0] += line.velocityX
	positions[1] += line.velocityY
}
