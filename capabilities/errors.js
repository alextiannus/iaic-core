// Only deliberately public, bounded codes cross protocol boundaries.
export const publicErrorFields=error=>typeof error?.publicCode==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.publicCode)?{code:error.publicCode}:{};
