import bcrypt from 'bcryptjs'

const ROUNDS = 10

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS)
export const verifyPassword = (plain, hash) => (hash ? bcrypt.compare(plain, hash) : Promise.resolve(false))
