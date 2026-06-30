import type { ReviewModel } from "../mock";

/** Every design direction is a full Review screen driven by the shared model. */
export interface DirectionProps {
  review: ReviewModel;
}
