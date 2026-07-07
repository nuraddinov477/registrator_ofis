import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id, login: user.login, role: user.role, name: user.fullName,
      // Rol qamrovi — guard va scoping token'dan o'qiydi
      facultyId: user.facultyId ?? null,
      departmentId: user.departmentId ?? null,
      teacherId: user.teacherId ?? null,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  )

export const verifyToken = (token) => jwt.verify(token, config.jwt.secret)
