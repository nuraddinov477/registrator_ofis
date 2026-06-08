// async route handlerlardagi xatolarni Express error middleware'ga uzatadi
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
