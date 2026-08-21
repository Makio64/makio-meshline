const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const MAX_SEMVER_LENGTH = 256
const MAX_SAFE_SEMVER_COMPONENT = BigInt( Number.MAX_SAFE_INTEGER )

export const parseSemver = ( value ) => {
	if ( typeof value !== 'string' || value.length > MAX_SEMVER_LENGTH ) return null
	const match = SEMVER_PATTERN.exec( value )
	if ( !match ) return null
	const [major, minor, patch] = match.slice( 1, 4 ).map( component => BigInt( component ) )
	if ( [major, minor, patch].some( component => component > MAX_SAFE_SEMVER_COMPONENT ) ) return null

	return {
		value,
		major,
		minor,
		patch,
		prerelease: match[4]?.split( '.' ) ?? [],
		build: match[5]?.split( '.' ) ?? [],
	}
}

const compareIdentifier = ( left, right ) => {
	const leftIsNumeric = /^\d+$/.test( left )
	const rightIsNumeric = /^\d+$/.test( right )

	if ( leftIsNumeric && rightIsNumeric ) {
		const leftNumber = BigInt( left )
		const rightNumber = BigInt( right )
		return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
	}
	if ( leftIsNumeric ) return -1
	if ( rightIsNumeric ) return 1
	return left < right ? -1 : left > right ? 1 : 0
}

export const compareSemver = ( leftValue, rightValue ) => {
	const left = typeof leftValue === 'string' ? parseSemver( leftValue ) : leftValue
	const right = typeof rightValue === 'string' ? parseSemver( rightValue ) : rightValue
	if ( !left || !right ) throw new Error( 'Cannot compare invalid semantic versions' )

	for ( const key of ['major', 'minor', 'patch'] ) {
		if ( left[key] < right[key] ) return -1
		if ( left[key] > right[key] ) return 1
	}

	if ( left.prerelease.length === 0 && right.prerelease.length === 0 ) return 0
	if ( left.prerelease.length === 0 ) return 1
	if ( right.prerelease.length === 0 ) return -1

	const identifierCount = Math.max( left.prerelease.length, right.prerelease.length )
	for ( let index = 0; index < identifierCount; index++ ) {
		if ( index >= left.prerelease.length ) return -1
		if ( index >= right.prerelease.length ) return 1
		const comparison = compareIdentifier( left.prerelease[index], right.prerelease[index] )
		if ( comparison !== 0 ) return comparison
	}

	return 0
}

export const validateNpmTag = ( tag ) => {
	if ( typeof tag !== 'string' || tag.length === 0 || tag.length > 214 ) {
		throw new Error( 'npm dist-tag must contain between 1 and 214 characters' )
	}
	if ( !/^[A-Za-z][0-9A-Za-z._-]*$/.test( tag ) ) {
		throw new Error( `Invalid npm dist-tag: ${tag}` )
	}
	if ( /^[vV]\d/.test( tag ) || /^[xX](?:\.|$)/.test( tag ) ) {
		throw new Error( `npm dist-tag must not be interpretable as a SemVer range: ${tag}` )
	}
	return tag
}

export const validateReleasePlan = ( {
	version,
	npmTag,
	publishedVersions = [],
	currentTagVersion = null,
	currentPackageVersion = null,
	allowPublished = false,
} ) => {
	const parsedVersion = parseSemver( version )
	if ( !parsedVersion ) throw new Error( `Invalid semantic version: ${version}` )
	validateNpmTag( npmTag )

	if ( parsedVersion.prerelease.length > 0 && npmTag === 'latest' ) {
		throw new Error( `Prerelease ${version} must not be published under the latest dist-tag` )
	}
	if ( currentPackageVersion ) {
		if ( !parseSemver( currentPackageVersion ) ) {
			throw new Error( `Current package manifest contains an invalid version: ${currentPackageVersion}` )
		}
		if ( compareSemver( version, currentPackageVersion ) < 0 ) {
			throw new Error( `${version} must not be older than the current package version ${currentPackageVersion}` )
		}
	}

	const alreadyPublished = publishedVersions.includes( version )
	if ( alreadyPublished && !allowPublished ) {
		throw new Error( `makio-meshline@${version} is already published` )
	}
	if ( alreadyPublished && currentTagVersion !== version ) {
		throw new Error( `makio-meshline@${version} is published, but the ${npmTag} dist-tag does not point to it` )
	}

	if ( currentTagVersion ) {
		if ( !parseSemver( currentTagVersion ) ) {
			throw new Error( `Registry returned an invalid version for ${npmTag}: ${currentTagVersion}` )
		}
		const comparison = compareSemver( version, currentTagVersion )
		if ( comparison < 0 || ( comparison === 0 && !alreadyPublished ) ) {
			throw new Error( `${version} must have higher precedence than the current ${npmTag} version ${currentTagVersion}` )
		}
	}

	return { alreadyPublished, npmTag, version }
}
