import { getGPUTier } from 'detect-gpu'
import speedTest from './speedTest'
import { isMobile } from '@/makio/utils/detect'

class DeviceInfo {
	constructor() {
		this.gpu = this.getGPU()
		this.bandWidth = {
			average: {
				mbps: 1.1,
			},
		}
	}

	calculateBandWidth() {
		return speedTest.getConnectionSpeed().then( ( bandWidth ) => {
			this.bandWidth = bandWidth
			return this.bandWidth
		} )
	}

	get isMobile() {
		return isMobile.phone
	}

	isTablet() {
		return isMobile.tablet
	}

	getGPU() {
		const gpuiInfo = getGPUTier( {
			mobileBenchmarkPercentages: [20, 45, 20, 15], // (Default) [TIER_0, TIER_1, TIER_2, TIER_3]
			desktopBenchmarkPercentages: [20, 45, 20, 15], // (Default) [TIER_0, TIER_1, TIER_2, TIER_3]
			// forceRendererString: "zzzz", // (Development) Force a certain renderer string
		} )
		let gpuScore = gpuiInfo.tier
		this.gpuScore = parseInt( gpuScore.substr( gpuScore.length - 1 ) )
		if ( isMobile ) {
			if ( this.gpuScore > 1 ) {
				this.gpuScore -= 1
			}
		}
		console.log( 'GPU SCORE', gpuScore )
		return { ...gpuiInfo, score: parseInt( this.gpuScore ) }
	}

	supportWebGL() {
		try {
			var canvas = document.createElement( 'canvas' )
			return !!window.WebGLRenderingContext && ( canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' ) )
		} catch ( e ) {
			return false
		}
	}
}

export default new DeviceInfo()
