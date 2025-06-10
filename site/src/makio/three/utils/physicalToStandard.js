import { MeshStandardNodeMaterial } from 'three/webgpu'

export const physicalToStandardMatNode = physicalMaterial => {
	const standardMaterial = new MeshStandardNodeMaterial()
		[
			'color',
			'metalness',
			'roughness',
			'map',
			'envMap',
			'normalMap',
			'emissive',
			'emissiveIntensity',
			'emissiveMap',
			'aoMap',
			'aoMapIntensity',
			'lightMap',
			'lightMapIntensity',
			'alphaMap',
			'bumpMap',
			'bumpScale',
			'displacementMap',
			'displacementScale',
			'displacementBias',
			'reflectivity'
		].forEach( key => standardMaterial[key] = physicalMaterial[key] )
	return standardMaterial
}
