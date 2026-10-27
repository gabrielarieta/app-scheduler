/** Converte _id -> id e remove campos internos ao serializar documentos. */
export const toJSONOptions = {
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, any>) => {
    if (ret._id) ret.id = ret._id.toString();
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
};
