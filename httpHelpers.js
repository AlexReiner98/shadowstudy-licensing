


function EnsureJson(req,res)
{
    const contentType = req.headers['content-type'];
    if(!contentType || !contentType.includes('application/json'))
    {
        return res.status(400).json({
            error: 'Invalid content type.',
            message: "Requests to this endpoint must have Content_Type of application/json."
        })
    }
}

function EnsureSize(req, res, maxSize)
{
        const contentSize = req.headers['content-length'];
        if(contentSize > maxSize)
        {
            return res.status(413).json({
                error: 'Payload too large',
                message: `Payload must be shorter than ${maxSize} characters.`
            })
        }
}

function EnsureFields(body, res, fields)
{
    for(let i = 0; i < fields.length; i++)
    {
        const key = fields[i];
        if(!body[key])
        {
            return res.status(417).json({
                error: 'Expectation Failed',
                message: `Body must contain field: ${key}`
            });
        };
    }
}

module.exports = {EnsureJson, EnsureSize, EnsureFields}
        