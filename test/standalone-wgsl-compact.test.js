import assert from 'node:assert/strict'
import test from 'node:test'

import { compactWGSL, localizeEntryPrivates, stabilizeFunctionNames, stabilizeStageIdentifiers } from '../demo/src/standalone/wgslCompact.js'

const SHADER = `// Three.js r187 - Node System
struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;
var<private> shared : f32;
var<private> nodeVar0 : vec4<f32>;

fn fn12 ( x : f32 ) -> f32 {
	return x * shared;
}

fn fn3 ( x : f32 ) -> f32 {
	return fn12( x ) + 1.0;
}

@fragment
fn main() -> OutputStruct {
	nodeVar0 = vec4<f32>( fn3( 0.5 ) );
	output.color = nodeVar0;
	return output;
}
`

test( 'entry-only privates become locals of the entry point, shared ones stay', () => {
	const code = localizeEntryPrivates( SHADER )
	assert.match( code, /^var<private> shared : f32;$/m )
	assert.doesNotMatch( code, /var<private> output\b/ )
	assert.doesNotMatch( code, /var<private> nodeVar0\b/ )
	assert.match( code, /fn main\(\) -> OutputStruct \{\n\tvar output : OutputStruct;\n\tvar nodeVar0 : vec4<f32>;\n/ )
} )

test( 'anonymous helpers are named by their order in the shader', () => {
	const code = stabilizeFunctionNames( SHADER )
	assert.match( code, /fn stable_fn0 \( x : f32 \)[^]*return x \* shared/ )
	assert.match( code, /return stable_fn0\( x \) \+ 1\.0/ )
	assert.match( code, /vec4<f32>\( stable_fn1\( 0\.5 \) \)/ )
	assert.doesNotMatch( code, /\bfn\d+\b/ )
	// A member call keeps its name, so the shader stays as three wrote it.
	const member = `${SHADER}fn helper() -> f32 { return value.fn3( 1.0 ); }\n`
	assert.equal( stabilizeFunctionNames( member ), member )
} )

test( 'stage identifiers are numbered by first appearance, suffixes kept', () => {
	const code = stabilizeStageIdentifiers( `
var nodeUniform7_sampler : sampler;
var nodeUniform7 : texture_2d<f32>;
struct nodeUniform3Struct { value : f32 };
const VERTEX_nodeConst12 = 1.0;
const VERTEX_nodeConst4 = 2.0;
@vertex
fn main() { let a = VERTEX_nodeConst4 + VERTEX_nodeConst12 + nodeConst9 + nodeConst2 + nodeConst9; }
` )
	assert.match( code, /var nodeUniform0_sampler : sampler;\nvar nodeUniform0 : texture_2d<f32>;\nstruct nodeUniform1Struct/ )
	// A pattern without a suffix group must not append the match offset (VERTEX_nodeConst01105).
	assert.match( code, /const VERTEX_nodeConst0 = 1\.0;\nconst VERTEX_nodeConst1 = 2\.0;/ )
	assert.match( code, /let a = VERTEX_nodeConst1 \+ VERTEX_nodeConst0 \+ nodeConst0 \+ nodeConst1 \+ nodeConst0;/ )
} )

test( 'compaction is stable: compacting twice changes nothing more', () => {
	const once = compactWGSL( SHADER )
	assert.notEqual( once, SHADER )
	assert.equal( compactWGSL( once ), once )
} )
