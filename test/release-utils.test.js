import assert from 'node:assert/strict'
import test from 'node:test'

import { compareSemver, parseSemver, validateNpmTag, validateReleasePlan } from '../scripts/release-utils.mjs'

test( 'strict semantic-version parsing rejects ambiguous versions', () => {
	for ( const version of ['2.0.0', '2.0.0-rc.1', '2.0.0+build.4', '2.0.0-rc.1+build.4'] ) {
		assert.ok( parseSemver( version ), version )
	}

	for ( const version of [
		'02.0.0',
		'2.0.0-01',
		'2.0.0-rc..1',
		'v2.0.0',
		'2.0',
		'9007199254740992.0.0',
		`2.0.0-${'a'.repeat( 251 )}`,
	] ) {
		assert.equal( parseSemver( version ), null, version )
	}
} )

test( 'semantic-version precedence handles prereleases and ignores build metadata', () => {
	assert.equal( compareSemver( '2.0.0-rc.1', '2.0.0-rc.2' ), -1 )
	assert.equal( compareSemver( '2.0.0-rc.2', '2.0.0' ), -1 )
	assert.equal( compareSemver( '2.0.0', '1.99.99' ), 1 )
	assert.equal( compareSemver( '2.0.0+one', '2.0.0+two' ), 0 )
} )

test( 'npm tags reject version-like and unsafe values', () => {
	for ( const tag of ['latest', 'next', 'beta', 'release-2'] ) assert.equal( validateNpmTag( tag ), tag )
	for ( const tag of ['2.0.0', 'v2', 'v1.4', 'x', 'x.1', 'X.1', '*', 'bad tag'] ) {
		assert.throws( () => validateNpmTag( tag ) )
	}
} )

test( 'release plans protect latest and keep each dist-tag monotonic', () => {
	assert.deepEqual(
		validateReleasePlan( {
			version: '2.0.0',
			npmTag: 'latest',
			publishedVersions: ['1.4.0'],
			currentTagVersion: '1.4.0',
		} ),
		{ alreadyPublished: false, npmTag: 'latest', version: '2.0.0' }
	)

	assert.throws( () => validateReleasePlan( {
		version: '2.0.0-rc.1',
		npmTag: 'latest',
	} ), /must not be published/ )
	assert.throws( () => validateReleasePlan( {
		version: '1.3.3',
		npmTag: 'latest',
		currentTagVersion: '1.4.0',
	} ), /higher precedence/ )
	assert.throws( () => validateReleasePlan( {
		version: '1.3.3',
		npmTag: 'legacy',
		currentPackageVersion: '1.4.0',
	} ), /must not be older/ )
	assert.throws( () => validateReleasePlan( {
		version: '1.3.3',
		npmTag: 'next',
		currentTagVersion: '1.2.3',
		currentPackageVersion: '1.4.0',
	} ), /must not be older/ )
	assert.doesNotThrow( () => validateReleasePlan( {
		version: '1.4.0',
		npmTag: 'legacy',
		currentPackageVersion: '1.4.0',
	} ) )
	assert.throws( () => validateReleasePlan( {
		version: '1.4.0',
		npmTag: 'latest',
		publishedVersions: ['1.4.0'],
		currentTagVersion: '1.4.0',
	} ), /already published/ )
	assert.deepEqual(
		validateReleasePlan( {
			version: '1.4.0',
			npmTag: 'latest',
			publishedVersions: ['1.4.0'],
			currentTagVersion: '1.4.0',
			allowPublished: true,
		} ),
		{ alreadyPublished: true, npmTag: 'latest', version: '1.4.0' }
	)
} )
