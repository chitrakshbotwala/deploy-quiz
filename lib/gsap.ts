import gsap from 'gsap';

/**
 * GSAP, core only.
 *
 * The landing page registers ScrollTrigger, ScrollSmoother, MotionPathPlugin and
 * ScrollToPlugin because it is one long pinned scroll. The quiz is a single
 * viewport that never scrolls the document — every animation here is a timeline
 * on a panel — so none of those plugins are imported, and their weight stays out
 * of the bundle.
 */
export { gsap };
