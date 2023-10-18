interface ObjectWithNestedProps {
    [key: string]: ObjectWithNestedProps | any;
}

export function getNestedValue(obj: ObjectWithNestedProps, path: string, defaultValue?: any, separator: string = '.'): any {
    const keys = path.split(separator);
    let value = obj;

    for (const key of keys) {
        if (typeof value !== 'object' || value === null) {
            return defaultValue;
        }

        value = value[key];
    }

    return value !== undefined ? value : defaultValue;
}