export const BRAND_NAME = "AI记账";
export const BRAND_TAGLINE = "让每一笔，都心里有数。";
export const BRAND_DESCRIPTION = "说一句，拍一张，轻松记录日常收支与人情往来。";
export const BRAND_COLOR = "#6257e8";
export const BRAND_MARK_COLOR = "#faf8f3";
export const BRAND_MARK_PATH = "M12 82C4 82 1 76 5 69L39 12C43 5 48 2 56 2H64C72 2 77 6 81 13L109 64C112 70 115 72 122 72V13C122 6 126 2 133 2H142C149 2 153 6 153 13V69C153 78 149 82 140 82H119C104 82 96 78 90 68L85 60H39L32 73C29 79 26 82 19 82H12ZM51 44H74L63 23L51 44Z";

/** Icon assets and the in-page logo share this exact lettermark. */
export function createBrandIconSvg(maskable = false) {
  // The maskable mark fits inside the central 80% safe-area circle.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="${BRAND_COLOR}"/><path transform="translate(84.4 163.6) scale(2.2)" fill="${BRAND_MARK_COLOR}" fill-rule="evenodd" d="${BRAND_MARK_PATH}"/></svg>`;
}
