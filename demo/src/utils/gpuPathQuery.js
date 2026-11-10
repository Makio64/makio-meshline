export const pick = ( value, allowed ) => allowed.includes( value ) ? value : allowed[0]

export const DEFAULT_SIMPLIFY = 99
export const MAX_SIMPLIFY = 99

// Matching CPU dyadic-oracle tolerance and retained segment count for each
// 0..99% simplification step on the demo's 200,000-point curve (199,999 segments).
const TOLERANCE_BY_PERCENT = [0, 2.966e-7, 3.882e-7, 4.436e-7, 5.015e-7, 5.512e-7, 6.056e-7, 6.455e-7, 6.701e-7, 6.907e-7, 7.152e-7, 7.385e-7, 7.76e-7, 7.981e-7, 8.091e-7, 8.204e-7, 8.371e-7, 8.489e-7, 8.702e-7, 8.978e-7, 9.298e-7, 9.633e-7, 9.943e-7, 0.000001021, 0.000001057, 0.000001092, 0.000001124, 0.000001157, 0.000001187, 0.00000121, 0.00000123, 0.00000126, 0.000001286, 0.000001308, 0.000001342, 0.000001373, 0.000001403, 0.000001429, 0.000001456, 0.000001482, 0.000001508, 0.000001532, 0.000001555, 0.000001571, 0.0000015795, 0.0000015877, 0.0000015936, 0.0000015971, 0.0000015999, 0.000001602, 0.0000016061, 0.000001638, 0.000001718, 0.000001797, 0.000001893, 0.000001955, 0.000002058, 0.000002143, 0.00000222, 0.000002302, 0.000002355, 0.000002394, 0.000002408, 0.000002417, 0.000002428, 0.000002457, 0.000002584, 0.000002705, 0.000002816, 0.000002891, 0.000002929, 0.000002954, 0.000002991, 0.00000324, 0.000003506, 0.000003829, 0.000004156, 0.000004614, 0.000005079, 0.000005553, 0.000006195, 0.000006794, 0.000007568, 0.00000833, 0.000009046, 0.00001012, 0.00001195, 0.00001371, 0.00001561, 0.00001846, 0.000023, 0.00002864, 0.0000349, 0.00004628, 0.00006136, 0.00008854, 0.0001356, 0.0002368, 0.0005466, 0.012]

const SEGMENTS_BY_PERCENT = [199_999, 198_079, 195_999, 194_079, 192_031, 189_983, 187_999, 186_047, 183_999, 182_079, 180_063, 178_015, 176_095, 174_079, 172_095, 170_015, 168_063, 166_079, 164_063, 162_015, 159_999, 158_015, 155_983, 154_079, 151_999, 149_951, 147_999, 146_047, 144_015, 141_967, 140_127, 138_143, 135_999, 133_999, 132_007, 130_039, 128_015, 126_023, 124_039, 121_951, 120_151, 118_119, 116_071, 113_983, 112_031, 109_967, 108_096, 106_144, 103_840, 101_984, 100_000, 98_016, 95_968, 94_000, 91_984, 89_988, 88_036, 86_068, 84_036, 82_068, 80_052, 77_996, 75_956, 74_100, 72_076, 70_056, 68_024, 66_002, 64_018, 61_986, 59_970, 58_010, 55_994, 54_012, 51_999, 50_003, 48_007, 46_014, 44_010, 42_079, 40_013, 37_993, 35_999, 34_000, 31_985, 29_998, 28_009, 26_058, 24_010, 22_001, 19_983, 17_981, 16_006, 13_998, 12_017, 10_014, 7_999, 6_000, 4_001, 1_646]

export const clampSimplify = ( value, fallback = DEFAULT_SIMPLIFY ) => {
	if ( value === null || value === undefined || value === '' ) return fallback
	const numeric = Number( value )
	if ( !Number.isFinite( numeric ) ) return fallback
	return Math.max( 0, Math.min( MAX_SIMPLIFY, Math.round( numeric ) ) )
}

export const resolveSimplify = percent => {
	const simplify = clampSimplify( percent )
	return {
		simplify,
		tolerance: TOLERANCE_BY_PERCENT[simplify],
		segments: SEGMENTS_BY_PERCENT[simplify],
	}
}

/** The demo's flags: ?simplify=0..99 ?topology= ?cap= ?wireframe=1 ?metrics=1 */
export function readQuery() {
	const query = new URLSearchParams( window.location.search )
	const topology = pick( query.get( 'topology' ), ['fixed', 'variable', 'bevel', 'round'] )
	const cap = pick( query.get( 'cap' ), ['butt', 'square', 'round'] )
	const advancedTopology = topology !== 'fixed' || cap !== 'butt'
	const simplify = advancedTopology ? 0 : clampSimplify( query.get( 'simplify' ) )
	const { tolerance, segments } = resolveSimplify( simplify )
	return {
		simplify,
		tolerance,
		segments,
		topology,
		cap,
		wireframe: ['1', 'true'].includes( query.get( 'wireframe' ) ),
		metrics: query.get( 'metrics' ) === '1',
	}
}

const replaceUrl = url => {
	const stopRouterNavigate = event => event.stopImmediatePropagation()
	window.navigation?.addEventListener( 'navigate', stopRouterNavigate, true )
	try {
		window.history.replaceState( null, '', url )
	} catch {
		// Ignore browser history rate limits.
	} finally {
		window.navigation?.removeEventListener( 'navigate', stopRouterNavigate, true )
	}
}

export function writeSimplify( simplify ) {
	const url = new URL( window.location.href )
	for ( const key of ['simplify', 'topology', 'cap'] ) url.searchParams.delete( key )
	if ( simplify !== DEFAULT_SIMPLIFY ) url.searchParams.set( 'simplify', String( simplify ) )
	replaceUrl( url )
}

export function writeWireframe( enabled ) {
	const url = new URL( window.location.href )
	if ( enabled ) url.searchParams.set( 'wireframe', '1' )
	else url.searchParams.delete( 'wireframe' )
	replaceUrl( url )
}
