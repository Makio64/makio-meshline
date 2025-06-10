// Concept
// Create uv base on the radius position
// Duplicate vertices when the mesh is fully connected at the end to avoid uv not looping correctly
// Author : David Ronai / @makio64

import { BufferAttribute } from 'three'
import { smoothstep } from '@/makio-utils/math'

//create uv on angle base
export default function ( geometry, attributeName, bb = null ) {
	if ( bb == null ) {
		geometry.computeBoundingBox()
		bb = geometry.boundingBox
	}
	let positions = geometry.attributes.position.array
	let normals = geometry.attributes.normal.array
	let uvs = geometry.attributes.normal.array

	let uv = [] //new Float32Array(positions.length*2/3)

	for ( let i = 0; i < positions.length; i += 3 ) {
		let k = ( i * 2 ) / 3
		let x = positions[i]
		let y = positions[i + 1]
		let z = positions[i + 2]
		let angle = Math.atan2( z, x )
		uv[k] = ( angle + Math.PI ) / ( Math.PI * 2 )
		uv[k + 1] = smoothstep( bb.min.y, bb.max.y, y )
	}

	let index = geometry.index.array
	let needsDuplicate = []
	let newIndex = []
	for ( let i = 0; i < index.length; i += 3 ) {
		if ( Math.abs( uv[index[i + 1] * 2] - uv[index[i] * 2] ) > 0.7 || Math.abs( uv[index[i + 2] * 2] - uv[index[i] * 2] ) > 0.7 ) {
			needsDuplicate.push( { index0: index[i], index1: index[i + 1], index2: index[i + 2] } )
		} else {
			newIndex.push( index[i + 0], index[i + 1], index[i + 2] )
		}
	}

	let npositions = Array.from( positions )
	let nnormals = Array.from( normals )
	let nuvs = Array.from( uvs )
	let currentIndex = positions.length / 3
	for ( let o of needsDuplicate ) {
		let small = 0
		if ( uv[o['index0'] * 2] < 0.5 ) small++
		if ( uv[o['index1'] * 2] < 0.5 ) small++
		if ( uv[o['index2'] * 2] < 0.5 ) small++
		let isSmall = small >= 2
		// console.log( uv[o['index0']*2], uv[o['index1']*2], uv[o['index2']*2])
		// console.log( Math.abs(uv[o['index1']*2] - uv[o['index0']*2]) > .7,
		//              Math.abs(uv[o['index2']*2] - uv[o['index0']*2]) > .7,
		//              Math.abs(uv[o['index1']*2] - uv[o['index1']*2]) > .7 )

		// duplicate the 3 points
		for ( let i = 0; i < 3; i++ ) {
			let pointToDuplicate = o['index' + i]
			let k2 = pointToDuplicate * 2
			let k3 = pointToDuplicate * 3
			npositions.push( positions[k3], positions[k3 + 1], positions[k3 + 2] )
			nnormals.push( normals[k3], normals[k3 + 1], normals[k3 + 2] )
			nuvs.push( uv[k2], uvs[k2 + 1] )
			let uvx = 0
			if ( isSmall ) {
				uvx = uv[k2] > 0.5 ? uv[k2] - 1 : uv[k2]
			} else {
				uvx = uv[k2] < 0.5 ? uv[k2] + 1 : uv[k2]
			}
			uv.push( uvx, uv[k2 + 1] )
		}
		newIndex.push( currentIndex, currentIndex + 1, currentIndex + 2 )
		currentIndex += 3
	}

	geometry.index.array = new Uint16Array( newIndex )
	geometry.index.count = newIndex.length
	geometry.index.needsUpdate = true
	geometry.attributes.position.array = new Float32Array( npositions )
	geometry.attributes.position.count = npositions.length / 3
	geometry.attributes.position.needsUpdate = true
	geometry.attributes.normal.array = new Float32Array( nnormals )
	geometry.attributes.normal.count = nnormals.length / 3
	geometry.attributes.normal.needsUpdate = true
	geometry.attributes.uv.array = new Float32Array( nuvs )
	geometry.attributes.uv.count = nuvs.length / 2
	geometry.attributes.uv.needsUpdate = true
	// geometry.computeVertexNormals()

	geometry.setAttribute( attributeName, new BufferAttribute( new Float32Array( uv ), 2 ) )
}
