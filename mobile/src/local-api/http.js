/** Erro com status HTTP, como o ResponseStatusException do Spring: vira uma resposta de erro para o front. */
export class HttpError extends Error {
    constructor(status, message, errors) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

/** Falha de validacao: errors e {campo: mensagem}, como o front espera. */
export const invalid = errors => new HttpError(400, 'Dados inválidos.', errors);
export const badRequest =(message, errors) => new HttpError(400, message, errors);
export const notFound = message => new HttpError(404, message);
export const conflict = message => new HttpError(409, message);
